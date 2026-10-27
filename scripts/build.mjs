// Build: tải ảnh và video gốc về, nén sang WebP, dựng index.html tĩnh vào dist/.
// Chạy trên Vercel mỗi lần deploy. Chạy thử ở máy: npm run build:offline (ảnh giả, không cần mạng).

import { mkdir, readFile, writeFile, rm, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'pmh-assets');
const OFFLINE = process.argv.includes('--offline') || process.env.PMH_OFFLINE === '1';

const site = JSON.parse(await readFile(path.join(ROOT, 'content', 'site.json'), 'utf8'));
const BASE = site.assets.base;
const warnings = [];
const log = (...a) => console.log('[build]', ...a);
const run = promisify(execFile);

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Nội dung có sẵn thẻ <em>, <strong> do mình viết trong site.json, giữ nguyên.
const rich = (s = '') => String(s);

const origin = (() => {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
  return host ? `https://${host}` : '';
})();

/* ---------- tải file gốc, có cache và thử lại ---------- */

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function getSource(remotePath) {
  const cached = path.join(CACHE, remotePath.replace(/[^A-Za-z0-9._-]/g, '_'));
  if (existsSync(cached)) return readFile(cached);
  if (OFFLINE) return null;
  try {
    const buf = await fetchWithRetry(BASE + remotePath);
    await mkdir(CACHE, { recursive: true });
    await writeFile(cached, buf);
    return buf;
  } catch (err) {
    warnings.push(`${remotePath}: ${err.message}`);
    return null;
  }
}

/* ---------- ảnh giả cho bản chạy thử offline ---------- */

function placeholder(w, h, label, tone) {
  const dark = tone === 'dark';
  const bg1 = dark ? '#0d1f45' : '#f6f4f0';
  const bg2 = dark ? '#081430' : '#e9e6df';
  const fg = dark ? '#d7e4ff' : '#1d2440';
  const fs = Math.round(Math.min(w, h) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="7%" y="42%" font-family="DejaVu Sans, sans-serif" font-weight="700" font-size="${fs}" fill="${fg}">${esc(label)}</text>
    <text x="7%" y="54%" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(fs / 2.4)}" fill="${fg}" opacity=".6">PHARMESTHETIC</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/* ---------- ảnh: nhiều kích thước WebP ---------- */

async function buildImage(remotePath, { w, h, widths, quality = 80, label = '', tone, alpha = false }) {
  const id = path.basename(remotePath).split('.')[0];
  let buf = await getSource(remotePath);
  if (!buf && OFFLINE) buf = await placeholder(w, h, label || id.slice(0, 8), tone);

  if (!buf) {
    // Không tải được: dùng tạm ảnh trên CDN gốc để trang vẫn hiển thị đủ.
    const u = BASE + remotePath;
    const steps = [512, 1024].filter((x) => x < w);
    return {
      src: steps.length ? `${u}?scale-down-to=${steps.at(-1)}` : u,
      srcset: [...steps.map((x) => `${u}?scale-down-to=${x} ${x}w`), `${u} ${w}w`].join(', '),
      w, h, remote: true,
    };
  }

  const meta = await sharp(buf).metadata();
  const realW = meta.width || w;
  const realH = meta.height || h;
  let targets = widths.filter((x) => x <= realW);
  if (!targets.length) targets = [realW];

  await mkdir(path.join(DIST, 'media'), { recursive: true });
  const out = [];
  for (const tw of targets) {
    const file = `media/${id}-${tw}.webp`;
    await sharp(buf)
      .resize({ width: tw, withoutEnlargement: true })
      .webp({ quality, alphaQuality: alpha ? 100 : undefined, effort: 5 })
      .toFile(path.join(DIST, file));
    out.push([`/${file}`, tw]);
  }
  const mid = out[Math.min(1, out.length - 1)];
  return {
    src: mid[0],
    srcset: out.map(([f, tw]) => `${f} ${tw}w`).join(', '),
    w: realW,
    h: realH,
  };
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

/* ---------- ảnh đầu trang cắt dọc cho điện thoại ---------- */

async function buildPortraitCrop(remotePath, { w, h, label, tone, quality = 74 }) {
  const id = path.basename(remotePath).split('.')[0];
  let buf = await getSource(remotePath);
  if (!buf && OFFLINE) buf = await placeholder(w, h, label, tone);
  if (!buf) return null;
  const meta = await sharp(buf).metadata();
  const cropW = Math.round((meta.height * 9) / 16 / 2) * 2;
  const left = Math.max(0, Math.round((meta.width - cropW) / 2));
  const file = `media/${id}-m-${cropW}.webp`;
  await mkdir(path.join(DIST, 'media'), { recursive: true });
  await sharp(buf)
    .extract({ left, top: 0, width: Math.min(cropW, meta.width), height: meta.height })
    .webp({ quality, effort: 5 })
    .toFile(path.join(DIST, file));
  return { src: `/${file}`, srcset: `/${file} ${cropW}w`, w: cropW, h: meta.height };
}

/* ---------- video nền: bản dọc nhẹ cho điện thoại, bản ngang cho máy tính ---------- */

async function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const m = await import('@ffmpeg-installer/ffmpeg');
    const p = (m.default || m).path;
    if (p && existsSync(p)) return p;
  } catch {}
  try { await run('ffmpeg', ['-version']); return 'ffmpeg'; } catch {}
  return null;
}

async function buildVideos() {
  const A = site.assets;
  const id = path.basename(A.heroVideo.path).split('.')[0];
  const buf = await getSource(A.heroVideo.path);
  if (!buf) return OFFLINE ? null : { m: BASE + A.heroVideo.path, d: BASE + A.heroVideo.path };

  await mkdir(path.join(DIST, 'media'), { recursive: true });
  const input = path.join(CACHE, A.heroVideo.path.replace(/[^A-Za-z0-9._-]/g, '_'));
  const ff = await findFfmpeg();
  if (ff) {
    try {
      const variants = {
        m: ['-vf', 'crop=trunc(ih*9/32)*2:ih:(iw-trunc(ih*9/32)*2)/2:0,scale=540:-2', '-crf', '30', '-profile:v', 'main'],
        d: ['-vf', "scale='min(1600,iw)':-2", '-crf', '27', '-profile:v', 'high'],
      };
      const out = {};
      for (const [k, args] of Object.entries(variants)) {
        const cached = path.join(CACHE, `hero-${id}-${k}.mp4`);
        if (!existsSync(cached)) {
          await run(ff, ['-y', '-loglevel', 'error', '-i', input, '-an', ...args,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', cached],
            { maxBuffer: 1 << 24 });
        }
        const file = `media/hero-${id}-${k}.mp4`;
        await copyFile(cached, path.join(DIST, file));
        out[k] = `/${file}`;
        log(`Video ${k === 'm' ? 'điện thoại' : 'máy tính'}: ${((await stat(cached)).size / 1048576).toFixed(1)} MB`);
      }
      log(`Video gốc: ${(buf.length / 1048576).toFixed(1)} MB`);
      return out;
    } catch (err) {
      warnings.push(`ffmpeg: ${String(err.message).split('\n')[0]}`);
    }
  }
  const file = `media/hero-${id}.mp4`;
  await writeFile(path.join(DIST, file), buf);
  return { m: `/${file}`, d: `/${file}` };
}

/* ---------- font tự host từ @fontsource ---------- */

const FONTS = [
  ['be-vietnam-pro', ['300', '400', '600', '600-italic', '800-italic']],
  ['noto-serif-display', ['300-italic']],
  ['great-vibes', ['400']],
];
const KEEP_SUBSETS = /-(latin|latin-ext|vietnamese)-\d/;

async function buildFonts() {
  await mkdir(path.join(DIST, 'fonts'), { recursive: true });
  const blocks = [];
  const preload = [];
  for (const [pkg, variants] of FONTS) {
    const dir = path.join(ROOT, 'node_modules', '@fontsource', pkg);
    for (const v of variants) {
      const css = await readFile(path.join(dir, `${v}.css`), 'utf8');
      for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
        const woff2 = (block.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
        if (!woff2 || !KEEP_SUBSETS.test(woff2)) continue;
        await copyFile(path.join(dir, 'files', woff2), path.join(DIST, 'fonts', woff2));
        blocks.push(block.replace(/src:[^;]+;/, `src: url(/fonts/${woff2}) format('woff2');`));
        if (/be-vietnam-pro-latin-800-italic|noto-serif-display-latin-300-italic/.test(woff2)) {
          preload.push(`/fonts/${woff2}`);
        }
      }
    }
  }
  return { css: blocks.join('\n'), preload };
}

/* ---------- tiện ích ---------- */

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

async function writeHashed(name, ext, content) {
  const file = `assets/${name}.${hash(content)}.${ext}`;
  await mkdir(path.join(DIST, 'assets'), { recursive: true });
  await writeFile(path.join(DIST, file), content);
  return `/${file}`;
}

const icon = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.9v3h2.6V21z" fill="currentColor"/></svg>',
  Instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor"/></svg>',
  YouTube: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.2 9.3v5.4l4.7-2.7z" fill="currentColor"/></svg>',
};

const SIZES = {
  landscape: '(min-width: 1140px) 352px, (min-width: 720px) 30vw, 46vw',
  wide: '(min-width: 1140px) 540px, (min-width: 720px) 46vw, 84vw',
  portrait: '(min-width: 1140px) 260px, (min-width: 720px) 22vw, 46vw',
};

/* ---------- dựng HTML ---------- */

function renderCard(card, session, img, index) {
  const isVideo = session.kind === 'video';
  const label = isVideo
    ? `Xem video ${card.title}. ${card.text}`
    : `Mở tài liệu ${card.title}, ${card.text}. Mở trong thẻ mới`;
  const loading = index < 2 && session.id === 'mastering' ? 'eager' : 'lazy';
  return `
        <li class="card" style="--i:${index}">
          <a class="card__link" href="${esc(card.href)}" target="_blank" rel="noopener" aria-label="${esc(label)}"${isVideo ? ` data-video="${esc(card.video)}" data-title="${esc(card.title)}"` : ''}>
            <span class="card__media">
              <img src="${esc(img.src)}" srcset="${esc(img.srcset)}" sizes="${SIZES[session.shape]}" width="${img.w}" height="${img.h}" alt="" loading="${loading}" decoding="async">
              ${isVideo ? `<span class="card__play">${icon.play}</span>` : ''}
            </span>
            <span class="card__body">
              <span class="card__title">${esc(card.title)}</span>
              <span class="card__text">${esc(card.text)}</span>
              <span class="card__cta">${isVideo ? 'Xem video' : 'Xem tài liệu'} ${icon.arrow}</span>
            </span>
          </a>
        </li>`;
}

function renderSession(s, images) {
  const sub = s.part ? `${s.part}. ${s.sub}` : s.sub;
  return `
    <section class="session" id="${s.id}" aria-labelledby="${s.id}-title" data-session="${s.nav ? s.id : 'treatment'}">
      <header class="session__head reveal">
        <h2 class="session__title" id="${s.id}-title">
          <span class="session__name"><span class="session__order">${esc(s.order)}</span><span class="session__tilde"> ~ </span><span class="session__key">${esc(s.key)}</span></span>
          <span class="session__sub">${esc(sub)}</span>
        </h2>
        <p class="session__quote">“<em>${esc(s.quote.em)}</em> ${esc(s.quote.rest)}”</p>
      </header>
      <ul class="grid grid--${s.shape}" role="list">${s.cards.map((c, i) => renderCard(c, s, images[i], i)).join('')}
      </ul>
      <p class="session__note">${esc(site.notice)}</p>
    </section>`;
}

function renderPage({ css, js, fontPreload, logo, badge, poster, posterM, videos, sessionsImages, favicons, og }) {
  const { title, description, lang, themeColor } = site.site;
  const nav = site.sessions.filter((s) => s.nav).map((s) =>
    `<a href="#${s.id}" data-nav="${s.id}"><span>${s.numeral}</span>${esc(s.nav)}</a>`).join('');
  const canonical = origin ? `${origin}/` : '';
  const ogImage = og.startsWith('http') ? og : (origin ? `${origin}${og}` : og);
  const f = site.footer;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${themeColor}">
<meta name="robots" content="max-image-preview:large">
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:type" content="website">
<meta property="og:locale" content="vi_VN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(ogImage)}">
${canonical ? `<meta property="og:url" content="${canonical}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="icon" href="${favicons.light}" media="(prefers-color-scheme: light)">
<link rel="icon" href="${favicons.dark}" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="${favicons.touch}">
${fontPreload.map((h) => `<link rel="preload" href="${h}" as="font" type="font/woff2" crossorigin>`).join('\n')}
${posterM ? `<link rel="preload" as="image" href="${esc(posterM.src)}" imagesrcset="${esc(posterM.srcset)}" imagesizes="100vw" media="(max-width: 719px)" fetchpriority="high">` : ''}
<link rel="preload" as="image" href="${esc(poster.src)}" imagesrcset="${esc(poster.srcset)}" imagesizes="100vw"${posterM ? ' media="(min-width: 720px)"' : ''} fetchpriority="high">
<link rel="manifest" href="/site.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Master House">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<link rel="stylesheet" href="${css}">
<script>document.documentElement.classList.add('js');window.__pmhFallback=setTimeout(function(){document.documentElement.classList.remove('js')},4000)</script>
</head>
<body>
<a class="skip" href="#thu-vien">Đi thẳng tới tài liệu</a>
<canvas class="sky" aria-hidden="true"></canvas>
<div class="nebula" aria-hidden="true"></div>

<header class="topbar" data-topbar>
  <div class="topbar__inner">
    <a class="topbar__logo" href="#top" aria-label="Về đầu trang">
      <img src="${esc(logo.src)}" srcset="${esc(logo.srcset)}" sizes="120px" width="${logo.w}" height="${logo.h}" alt="GIVEHADA">
    </a>
    <nav class="topbar__nav" aria-label="Các phần tài liệu">${nav}</nav>
  </div>
</header>

<main id="top">
  <section class="hero" data-hero>
    <div class="hero__media" aria-hidden="true">
      <picture>
        ${posterM ? `<source media="(max-width: 719px)" srcset="${esc(posterM.srcset)}" sizes="100vw" width="${posterM.w}" height="${posterM.h}">` : ''}
        <img class="hero__poster" src="${esc(poster.src)}" srcset="${esc(poster.srcset)}" sizes="100vw" width="${poster.w}" height="${poster.h}" alt="" fetchpriority="high">
      </picture>
      ${videos ? `<video class="hero__video" muted loop playsinline disablepictureinpicture preload="none" data-src-m="${esc(videos.m)}" data-src-d="${esc(videos.d)}"></video>` : ''}
    </div>
    <div class="hero__shade" aria-hidden="true"></div>
    <div class="hero__inner">
      <img class="hero__logo" src="${esc(logo.src)}" srcset="${esc(logo.srcset)}" sizes="(min-width: 720px) 220px, 160px" width="${logo.w}" height="${logo.h}" alt="GIVEHADA">
      <p class="hero__welcome">${esc(site.hero.welcome)} <em>${esc(site.hero.brand)}</em></p>
      <h1 class="hero__title">${esc(site.hero.title)}</h1>
      <p class="hero__tagline">${esc(site.hero.tagline)}</p>
    </div>
    <a class="hero__cue" href="#manifesto" aria-label="Cuộn xuống phần giới thiệu"><span></span></a>
  </section>

  <section class="manifesto" id="manifesto" aria-label="Giới thiệu">
    <blockquote class="manifesto__quote reveal">
      ${site.manifesto.map((line, i) => `<p${i === 1 ? ' class="manifesto__values"' : ''}>${rich(line)}</p>`).join('\n      ')}
    </blockquote>
  </section>

  <div id="thu-vien" class="library">
${site.sessions.map((s, i) => renderSession(s, sessionsImages[i])).join('\n')}
  </div>

  <footer class="footer">
    <p class="footer__more reveal">${esc(f.more)}</p>
    <div class="footer__grid">
      <div class="footer__info">
        <p class="footer__project">${esc(f.project)}</p>
        <p>${esc(f.company)}</p>
        <p>${esc(f.address)}</p>
        <p>${esc(f.registration)}</p>
      </div>
      <div class="footer__aside">
        <a class="footer__badge" href="${esc(f.badgeHref)}" target="_blank" rel="noopener" aria-label="Đã thông báo Bộ Công Thương">
          <img src="${esc(badge.src)}" srcset="${esc(badge.srcset)}" sizes="132px" width="${badge.w}" height="${badge.h}" alt="Đã thông báo Bộ Công Thương" loading="lazy" decoding="async">
        </a>
        <ul class="footer__social" role="list">
          ${f.social.map((s) => `<li><a href="${esc(s.href)}" target="_blank" rel="noopener" aria-label="${esc(s.name)} GIVEHADA">${icon[s.name] || esc(s.name)}</a></li>`).join('\n          ')}
        </ul>
      </div>
    </div>
  </footer>
</main>

<div class="player" data-player hidden>
  <div class="player__backdrop" data-close></div>
  <div class="player__box" role="dialog" aria-modal="true" aria-labelledby="player-title">
    <div class="player__bar">
      <p class="player__title" id="player-title"></p>
      <div class="player__actions">
        <a class="player__btn" data-player-ext href="#" target="_blank" rel="noopener">YouTube</a>
        <button class="player__btn" type="button" data-close>Đóng</button>
      </div>
    </div>
    <div class="player__frame"></div>
  </div>
</div>

<script src="${js}" defer></script>
</body>
</html>
`;
}

/* ---------- chạy ---------- */

async function main() {
  const t0 = Date.now();
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  log(OFFLINE ? 'Chế độ offline: dùng ảnh giả' : `Tải tài nguyên từ ${BASE}`);

  const A = site.assets;
  const fonts = await buildFonts();

  const [logo, badge, poster] = await Promise.all([
    buildImage(A.logo.path, { ...A.logo, widths: [240, 480], quality: 90, alpha: true, label: 'GIVEHADA', tone: 'dark' }),
    buildImage(A.badge.path, { ...A.badge, widths: [264], quality: 90, alpha: true, label: 'BCT' }),
    buildImage(A.heroPoster.path, { ...A.heroPoster, widths: [960, 1920], quality: 74, label: 'MASTER AESTHETIC HOUSE', tone: 'dark' }),
  ]);

  const posterM = await buildPortraitCrop(A.heroPoster.path, { ...A.heroPoster, label: 'MASTER', tone: 'dark' });
  const videos = await buildVideos();

  // Favicon và ảnh chia sẻ
  const favicons = {};
  for (const [key, a, file] of [['dark', A.faviconDark, 'favicon-dark.png'], ['light', A.faviconLight, 'favicon-light.png']]) {
    const b = await getSource(a.path);
    if (b) { await sharp(b).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(DIST, file)); favicons[key] = `/${file}`; }
    else favicons[key] = OFFLINE ? '' : BASE + a.path;
  }
  {
    const b = (await getSource(A.faviconDark.path)) || null;
    if (b) { await sharp(b).resize(180, 180, { fit: 'contain', background: '#030417' }).png().toFile(path.join(DIST, 'apple-touch-icon.png')); favicons.touch = '/apple-touch-icon.png'; }
    else favicons.touch = favicons.dark;
  }
  let og = '/og.jpg';
  {
    const b = await getSource(A.og.path);
    if (b) await sharp(b).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(DIST, 'og.jpg'));
    else og = OFFLINE ? '/og.jpg' : BASE + A.og.path;
  }

  // Biểu tượng khi thêm vào màn hình chính điện thoại
  const manifestIcons = [];
  {
    const b = await getSource(A.faviconDark.path);
    if (b) {
      for (const size of [192, 512]) {
        const inner = Math.round(size * 0.6);
        const mark = await sharp(b).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        await sharp({ create: { width: size, height: size, channels: 4, background: '#030417' } })
          .composite([{ input: mark, gravity: 'center' }]).png().toFile(path.join(DIST, `icon-${size}.png`));
        manifestIcons.push({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' });
      }
    }
  }
  await writeFile(path.join(DIST, 'site.webmanifest'), JSON.stringify({
    name: 'Pharmesthetic Master Aesthetic House',
    short_name: 'Master House',
    description: site.site.description,
    lang: 'vi',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#030417',
    theme_color: '#030417',
    icons: manifestIcons,
  }, null, 2));

  // Ảnh tài liệu
  const jobs = [];
  site.sessions.forEach((s, si) => s.cards.forEach((c, ci) => jobs.push({ s, si, c, ci })));
  const widthsFor = { landscape: [480, 640, 960, 1440], wide: [640, 960, 1280], portrait: [400, 600, 800, 1200] };
  const built = await pool(jobs, 4, ({ s, c }) => buildImage(c.img, {
    w: c.w, h: c.h, widths: widthsFor[s.shape], quality: s.kind === 'video' ? 72 : 80, label: c.title, tone: s.tone,
  }));
  const sessionsImages = site.sessions.map(() => []);
  jobs.forEach((j, k) => { sessionsImages[j.si][j.ci] = built[k]; });

  // CSS, JS có hash để cache lâu dài
  const cssText = `${fonts.css}\n${await readFile(path.join(SRC, 'styles.css'), 'utf8')}`;
  const css = await writeHashed('site', 'css', cssText);
  const js = await writeHashed('app', 'js', await readFile(path.join(SRC, 'app.js'), 'utf8'));

  const html = renderPage({ css, js, fontPreload: fonts.preload, logo, badge, poster, posterM, videos, sessionsImages, favicons, og });
  await writeFile(path.join(DIST, 'index.html'), html);
  await writeFile(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');

  const remote = built.filter((b) => b.remote).length;
  log(`Xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s. ${built.length} ảnh tài liệu, ${remote} ảnh dùng tạm CDN gốc.`);
  if (warnings.length) {
    console.warn('[build] Cảnh báo:');
    for (const w of warnings) console.warn('  ', w);
  }
}

await main();
