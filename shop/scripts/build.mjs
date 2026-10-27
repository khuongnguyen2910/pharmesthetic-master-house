// Build trang bán hàng Pharmesthetic Homecare.
// Vercel chạy `npm run build` mỗi lần deploy: tải ảnh sản phẩm từ cdn.givehada.com, nén WebP nhiều cỡ, dựng dist/.
// Chạy thử ở máy: `npm run build:offline` (ảnh giả, không cần mạng).
// Bản xem trước một file: `npm run build:single` (font, CSS, JS nhúng sẵn; ảnh lấy thẳng từ cdn.givehada.com).

import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'shop-assets');
const OFFLINE = process.argv.includes('--offline') || process.env.SHOP_OFFLINE === '1';
const SINGLE = process.argv.includes('--single');
const DIST = path.join(ROOT, SINGLE ? 'dist-preview' : 'dist');

const site = JSON.parse(await readFile(path.join(ROOT, 'content', 'site.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(ROOT, 'content', 'products.json'), 'utf8'));
const warnings = [];
const log = (...a) => console.log('[build]', ...a);

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Nội dung có sẵn thẻ <em>, <strong> do mình viết trong site.json, giữ nguyên.
const rich = (s = '') => String(s);
const money = (n) => `${Number(n).toLocaleString('vi-VN').replace(/,/g, '.')}${site.order.currency}`;

const origin = SINGLE ? '' : (() => {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
  return host ? `https://${host}` : '';
})();

const ORDER_ENDPOINT = process.env.ORDER_ENDPOINT || site.order.endpoint || '';

/* ---------- dữ liệu sản phẩm ---------- */

const products = catalog.products;
const bySku = new Map(products.map((p) => [p.sku, p]));
const missing = [
  ...site.signature.flatMap((f) => f.skus),
  ...site.rituals.flatMap((r) => r.items.map((i) => i.sku)),
].filter((sku) => !bySku.has(sku));
if (missing.length) throw new Error(`Thiếu sản phẩm trong products.json: ${missing.join(', ')}`);

/* ---------- tải file gốc, có cache và thử lại ---------- */

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'givehada-shop-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function getSource(url) {
  // Bản một file không kèm thư mục ảnh: dùng thẳng ảnh gốc.
  if (SINGLE) return null;
  const cached = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]/g, '_'));
  if (existsSync(cached)) return readFile(cached);
  if (OFFLINE) return null;
  try {
    const buf = await fetchWithRetry(url);
    await mkdir(CACHE, { recursive: true });
    await writeFile(cached, buf);
    return buf;
  } catch (err) {
    warnings.push(`${url}: ${err.message}`);
    return null;
  }
}

/* ---------- ảnh giả cho bản chạy thử offline ---------- */

function placeholder(w, h, label) {
  const fs = Math.round(Math.min(w, h) / 11);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#e2ddd2"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="${w * 0.36}" y="${h * 0.2}" width="${w * 0.28}" height="${h * 0.5}" rx="${w * 0.03}" fill="#1d2440" opacity=".88"/>
    <text x="50%" y="${h * 0.84}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="700" font-size="${fs}" fill="#1d2440">${esc(label)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/* ---------- ảnh: nhiều kích thước WebP ---------- */

async function buildImage(url, { widths, quality = 78, label = '', alpha = false, w = 1200, h = 1200 }) {
  const id = url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9]+/g, '-').slice(-40);
  let buf = await getSource(url);
  if (!buf && OFFLINE) buf = await placeholder(w, h, label || id.slice(-8));

  if (!buf) {
    // Không tải được, hoặc bản một file: dùng thẳng ảnh gốc trên CDN.
    return { src: url, srcset: '', w, h, remote: true };
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
    if (!existsSync(path.join(DIST, file))) {
      await sharp(buf)
        .rotate()
        .resize({ width: tw, withoutEnlargement: true })
        .webp({ quality, alphaQuality: alpha ? 100 : undefined, effort: 5 })
        .toFile(path.join(DIST, file));
    }
    out.push([`/${file}`, tw]);
  }
  const mid = out[Math.min(1, out.length - 1)];
  return { src: mid[0], srcset: out.map(([f, tw]) => `${f} ${tw}w`).join(', '), w: realW, h: realH };
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

/* ---------- font tự host từ @fontsource ---------- */

const FONTS = [
  ['be-vietnam-pro', ['300', '400', '500', '600', '600-italic', '800-italic']],
  ['noto-serif-display', ['300-italic']],
  ['great-vibes', ['400']],
];
const KEEP_SUBSETS = /-(latin|latin-ext|vietnamese)-\d/;

async function buildFonts(inline = false) {
  if (!inline) await mkdir(path.join(DIST, 'fonts'), { recursive: true });
  const blocks = [];
  const preload = [];
  for (const [pkg, variants] of FONTS) {
    const dir = path.join(ROOT, 'node_modules', '@fontsource', pkg);
    for (const v of variants) {
      const css = await readFile(path.join(dir, `${v}.css`), 'utf8');
      for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
        const woff2 = (block.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
        if (!woff2 || !KEEP_SUBSETS.test(woff2)) continue;
        const file = path.join(dir, 'files', woff2);
        if (inline) {
          const b64 = (await readFile(file)).toString('base64');
          blocks.push(block.replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${b64}) format('woff2');`));
          continue;
        }
        await copyFile(file, path.join(DIST, 'fonts', woff2));
        blocks.push(block.replace(/src:[^;]+;/, `src: url(/fonts/${woff2}) format('woff2');`));
        if (/be-vietnam-pro-latin-800-italic|noto-serif-display-latin-300-italic|be-vietnam-pro-vietnamese-400-normal/.test(woff2)) {
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
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.9v3h2.6V21z" fill="currentColor"/></svg>',
  Instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor"/></svg>',
  Zalo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c-5 0-9 3.4-9 7.6 0 2.3 1.2 4.4 3.1 5.8l-.6 3.1 3.3-1.7c1 .3 2.1.5 3.2.5 5 0 9-3.4 9-7.7S17 3.5 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9.3h3.3L8 13.3h3.4M13 9.6v3.8M15.6 9.3v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const SIZES = {
  card: '(min-width: 1140px) 260px, (min-width: 720px) 30vw, 46vw',
  feature: '(min-width: 1140px) 540px, (min-width: 720px) 46vw, 100vw',
};

const imgTag = (img, { sizes, alt = '', loading = 'lazy', cls = '', extra = '' } = {}) =>
  `<img${cls ? ` class="${cls}"` : ''} src="${esc(img.src)}"${img.srcset ? ` srcset="${esc(img.srcset)}" sizes="${sizes}"` : ''} width="${img.w}" height="${img.h}" alt="${esc(alt)}" loading="${loading}" decoding="async"${img.remote ? ' referrerpolicy="no-referrer"' : ''}${extra}>`;

/* ---------- dựng HTML ---------- */

function sectionHead(key) {
  const s = site.sections[key];
  return `
      <header class="sect__head reveal">
        <h2 class="sect__title" id="${key}-title">
          <span class="sect__name"><span class="sect__numeral">${esc(s.numeral)}.</span> ${esc(s.title)}</span>
          <span class="sect__sub">${esc(s.sub)}</span>
        </h2>
        <p class="sect__quote">“<em>${esc(s.quote.em)}</em> ${esc(s.quote.rest)}”</p>
      </header>`;
}

function qtyControl(id) {
  return `<div class="qty" data-qty="${id}">
              <button type="button" class="qty__btn" data-step="-1" aria-label="Bớt một">${icon.minus}</button>
              <input class="qty__input" type="number" inputmode="numeric" min="1" max="${site.order.maxQty}" value="1" aria-label="Số lượng">
              <button type="button" class="qty__btn" data-step="1" aria-label="Thêm một">${icon.plus}</button>
            </div>`;
}

function renderFeature(f, index, imgs) {
  const items = f.skus.map((s) => bySku.get(s));
  const first = items[0];
  const name = f.title || first.name;
  const variants = items.length > 1
    ? `<div class="variants" role="radiogroup" aria-label="Chọn quy cách">
            ${items.map((p, i) => `<button type="button" class="variant${i === 0 ? ' is-on' : ''}" role="radio" aria-checked="${i === 0}" data-variant="${p.sku}" data-price="${p.price}" data-size="${esc(p.size)}">
              <span class="variant__label">${esc((f.variantLabels || {})[p.sku] || p.size)}</span>
              <span class="variant__price">${money(p.price)}</span>
            </button>`).join('\n            ')}
          </div>`
    : '';
  const chips = (first.contents && first.contents.length ? first.contents : first.ingredients).slice(0, 6);
  return `
      <article class="feature${index % 2 ? ' feature--flip' : ''} reveal" data-feature="${first.sku}">
        <button type="button" class="feature__media" data-open="${first.sku}" data-label="${esc(name)}" aria-label="Xem chi tiết ${esc(name)}">
          ${imgTag(imgs[0], { sizes: SIZES.feature, loading: index === 0 ? 'eager' : 'lazy' })}
          <span class="feature__index">${String(index + 1).padStart(2, '0')}</span>
        </button>
        <div class="feature__body">
          <p class="feature__kicker">${esc(f.kicker)}</p>
          <h3 class="feature__name">${esc(name)}</h3>
          <p class="feature__type">${esc(first.brand)}. ${esc(first.type)}</p>
          <p class="feature__line">${esc(f.line)}</p>
          ${chips.length ? `<ul class="chips" role="list" aria-label="${first.contents ? 'Trong hộp' : 'Thành phần nổi bật'}">${chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
          ${variants}
          <div class="buy">
            <p class="buy__price"><span data-price-out>${money(first.price)}</span><span class="buy__size" data-size-out>${esc(first.size)}</span></p>
            <div class="buy__row">
              ${qtyControl(`f${index}`)}
              <button type="button" class="btn btn--gold" data-add-feature="${index}">${icon.bag}<span>Thêm vào đơn</span></button>
            </div>
          </div>
          <button type="button" class="textlink" data-open="${first.sku}">Xem chi tiết ${icon.arrow}</button>
        </div>
      </article>`;
}

function renderCard(p, img, i) {
  return `
        <li class="pcard" data-cat="${p.cat}" data-sku="${p.sku}" style="--i:${i % 8}">
          <button type="button" class="pcard__media" data-open="${p.sku}" data-label="${esc(p.name)}" aria-label="Xem chi tiết ${esc(p.name)}">
            ${imgTag(img, { sizes: SIZES.card })}
          </button>
          <div class="pcard__body">
            <p class="pcard__brand">${esc(p.brand)}</p>
            <h3 class="pcard__name"><button type="button" data-open="${p.sku}">${esc(p.name)}</button></h3>
            <p class="pcard__short">${esc(p.short)}</p>
            <div class="pcard__foot">
              <p class="pcard__price">${money(p.price)}<span>${esc(p.size)}</span></p>
              <button type="button" class="pcard__add" data-add="${p.sku}" aria-label="Thêm ${esc(p.name)} vào đơn">${icon.plus}<span>Thêm</span></button>
            </div>
          </div>
        </li>`;
}

function renderRitual(r) {
  const lines = r.items.map((it) => ({ p: bySku.get(it.sku), qty: it.qty }));
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  return `
        <li class="ritual reveal">
          <p class="ritual__for">${esc(r.for)}</p>
          <h3 class="ritual__name">${esc(r.name)}</h3>
          <div class="ritual__steps">
            ${r.steps.map((st) => `<div class="ritual__block">
              <p class="ritual__time">${esc(st.time)}</p>
              <ol>${st.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
            </div>`).join('\n            ')}
          </div>
          <ul class="ritual__items" role="list">
            ${lines.map((l) => `<li><button type="button" data-open="${l.p.sku}">${esc(l.p.name)}</button><span>${l.qty > 1 ? `${l.qty} x ` : ''}${money(l.p.price)}</span></li>`).join('\n            ')}
          </ul>
          <div class="ritual__foot">
            <p class="ritual__total"><span>Cả liệu trình</span>${money(total)}</p>
            <button type="button" class="btn btn--line" data-add-set="${r.items.map((it) => `${it.sku}:${it.qty}`).join(',')}">${icon.bag}<span>Thêm cả liệu trình</span></button>
          </div>
        </li>`;
}

function renderPage({ css, js, fontPreload, logo, featureImgs, cardImgs, favicons, og, data }) {
  const { title, description, lang, themeColor, appName } = site.site;
  const S = site.sections;
  const navKeys = ['signature', 'collection', 'rituals', 'order'];
  const ids = { signature: 'chu-luc', collection: 'san-pham', rituals: 'lieu-trinh', order: 'dat-hang' };
  const nav = navKeys.map((k) =>
    `<a href="#${ids[k]}" data-nav="${k}"><span>${S[k].numeral}</span>${esc(S[k].nav)}${k === 'order' ? '<b class="badge" data-count hidden>0</b>' : ''}</a>`).join('');
  const canonical = origin ? `${origin}/` : '';
  const ogImage = og ? (og.startsWith('http') ? og : (origin ? `${origin}${og}` : og)) : '';
  const f = site.footer;
  const F = site.form;
  const cats = catalog.categories.map((c) => ({ ...c, n: products.filter((p) => p.cat === c.id).length })).filter((c) => c.n);
  // Lưới sản phẩm xếp theo thứ tự bước chăm sóc: làm sạch, cân bằng, dưỡng, mặt nạ, bảo vệ, bộ
  const catOrder = catalog.categories.map((c) => c.id);
  const gridOrder = products.map((p, i) => ({ p, i }))
    .sort((a, b) => catOrder.indexOf(a.p.cat) - catOrder.indexOf(b.p.cat) || a.i - b.i);

  const topLogo = imgTag(logo, { sizes: '120px', alt: 'GIVEHADA', loading: 'eager', extra: ' data-wordmark="wordmark topbar__wordmark"' });
  const heroLogo = imgTag(logo, { cls: 'hero__logo', sizes: '(min-width: 720px) 200px, 150px', alt: 'GIVEHADA', loading: 'eager', extra: ' fetchpriority="high" data-wordmark="wordmark hero__wordmark"' });

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="theme-color" content="${themeColor}">`,
    SINGLE ? `<meta name="robots" content="noindex">` : `<meta name="robots" content="index, follow, max-image-preview:large">`,
    canonical && `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="vi_VN">`,
    `<meta property="og:site_name" content="${esc(appName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    ogImage && `<meta property="og:image" content="${esc(ogImage)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">`,
    canonical && `<meta property="og:url" content="${canonical}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    ogImage && `<meta name="twitter:image" content="${esc(ogImage)}">`,
    favicons.light && `<link rel="icon" href="${favicons.light}" media="(prefers-color-scheme: light)">`,
    favicons.dark && `<link rel="icon" href="${favicons.dark}" media="(prefers-color-scheme: dark)">`,
    favicons.touch && `<link rel="apple-touch-icon" href="${favicons.touch}">`,
    ...fontPreload.map((h) => `<link rel="preload" href="${h}" as="font" type="font/woff2" crossorigin>`),
    !SINGLE && `<link rel="manifest" href="/site.webmanifest">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-title" content="${esc(site.site.shortName)}">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
    `<meta name="format-detection" content="telephone=no">`,
    css.inline ? `<style>\n${css.inline}\n</style>` : `<link rel="stylesheet" href="${css.href}">`,
    `<script>document.documentElement.classList.add('js');window.__shopFallback=setTimeout(function(){document.documentElement.classList.remove('js')},4000)</script>`,
  ].filter(Boolean).join('\n');

  return `<!doctype html>
<html lang="${lang}">
<head>
${head}
</head>
<body>
<a class="skip" href="#san-pham">Đi thẳng tới sản phẩm</a>
<canvas class="sky" aria-hidden="true"></canvas>
<div class="nebula" aria-hidden="true"></div>

<header class="topbar" data-topbar>
  <div class="topbar__inner">
    <a class="topbar__logo" href="#top" aria-label="Về đầu trang">
      ${topLogo}
    </a>
    <nav class="topbar__nav" aria-label="Các phần của trang">${nav}</nav>
  </div>
</header>

<main id="top">
  <section class="hero" data-hero>
    <div class="hero__halo" aria-hidden="true"></div>
    <div class="hero__inner">
      ${heroLogo}
      <p class="hero__welcome">${esc(site.hero.welcome)} <em>${esc(site.hero.brand)}</em></p>
      <h1 class="hero__title">${esc(site.hero.title)}</h1>
      <p class="hero__tagline">${esc(site.hero.tagline)}</p>
      <p class="hero__lead">${esc(site.hero.lead)}</p>
      <div class="hero__cta">
        <a class="btn btn--gold" href="#san-pham">${esc(site.hero.primary)} ${icon.arrow}</a>
        <a class="btn btn--line" href="#dat-hang" data-consult>${esc(site.hero.secondary)}</a>
      </div>
    </div>
    <a class="hero__cue" href="#manifesto" aria-label="Cuộn xuống"><span></span></a>
  </section>

  <section class="manifesto" id="manifesto" aria-label="Giới thiệu">
    <blockquote class="manifesto__quote reveal">
      ${site.manifesto.map((line, i) => `<p${i === 1 ? ' class="manifesto__values"' : ''}>${rich(line)}</p>`).join('\n      ')}
    </blockquote>
    <ul class="promise reveal" role="list">
      ${site.promise.map((p) => `<li><span class="promise__mark">${icon.check}</span><p class="promise__title">${esc(p.title)}</p><p class="promise__text">${esc(p.text)}</p></li>`).join('\n      ')}
    </ul>
  </section>

  <section class="sect" id="chu-luc" aria-labelledby="signature-title" data-section="signature">${sectionHead('signature')}
    <div class="features">${site.signature.map((fe, i) => renderFeature(fe, i, featureImgs[i])).join('')}
    </div>
  </section>

  <section class="sect" id="san-pham" aria-labelledby="collection-title" data-section="collection">${sectionHead('collection')}
    <div class="filters" role="toolbar" aria-label="Lọc theo bước chăm sóc">
      <button type="button" class="filter is-on" data-filter="all" aria-pressed="true">Tất cả<span>${products.length}</span></button>
      ${cats.map((c) => `<button type="button" class="filter" data-filter="${c.id}" aria-pressed="false">${esc(c.label)}<span>${c.n}</span></button>`).join('\n      ')}
    </div>
    <ul class="pgrid" role="list" data-grid>${gridOrder.map(({ p, i }, k) => renderCard(p, cardImgs[i], k)).join('')}
    </ul>
  </section>

  <section class="sect" id="lieu-trinh" aria-labelledby="rituals-title" data-section="rituals">${sectionHead('rituals')}
    <ul class="rituals" role="list">${site.rituals.map(renderRitual).join('')}
    </ul>
  </section>

  <section class="sect sect--order" id="dat-hang" aria-labelledby="order-title" data-section="order">${sectionHead('order')}
    <div class="order" data-order>
      <div class="order__cart">
        <div class="cart" aria-live="polite">
          <div class="cart__head"><h3>Đơn của bạn</h3><button type="button" class="textlink textlink--muted" data-clear hidden>Xóa hết</button></div>
          <ul class="cart__list" role="list" data-cart-list></ul>
          <p class="cart__empty" data-cart-empty>${esc(F.empty)}</p>
          <div class="cart__sum" data-cart-sum hidden>
            <p><span>Tạm tính</span><strong data-subtotal>0${site.order.currency}</strong></p>
            <p class="cart__note">${esc(F.feeNote)}</p>
          </div>
        </div>
      </div>

      <form class="form" data-form novalidate>
        <div class="field">
          <label for="f-name">${esc(F.name)}</label>
          <input id="f-name" name="name" type="text" autocomplete="name" maxlength="80" required>
          <p class="field__err" data-err="name">Vui lòng nhập họ và tên.</p>
        </div>
        <div class="field">
          <label for="f-phone">${esc(F.phone)}</label>
          <input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" required>
          <p class="field__err" data-err="phone">Số điện thoại chưa đúng, ví dụ 0901234567.</p>
        </div>
        <div class="field">
          <label for="f-address">${esc(F.address)}</label>
          <textarea id="f-address" name="address" rows="2" autocomplete="street-address" maxlength="300" required></textarea>
          <p class="field__err" data-err="address">Vui lòng nhập địa chỉ nhận hàng.</p>
        </div>
        <div class="field">
          <label for="f-note">${esc(F.note)} <span>Không bắt buộc</span></label>
          <textarea id="f-note" name="note" rows="2" maxlength="500" placeholder="${esc(F.notePlaceholder)}"></textarea>
        </div>
        <label class="check">
          <input type="checkbox" name="consult" data-consult-box>
          <span class="check__box">${icon.check}</span>
          <span>${esc(F.consult)}</span>
        </label>
        <div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <p class="form__err" data-err="cart">${esc(F.empty)}</p>
        <button type="submit" class="btn btn--gold btn--block" data-submit data-label="${esc(F.submit)}" data-label-consult="${esc(F.submitConsult)}">${esc(F.submit)}</button>
        <p class="form__consent">${esc(F.consent)} <a href="${esc(site.order.policy)}" target="_blank" rel="noopener">Xem chính sách</a>.</p>
        <div class="form__status" data-status role="status" hidden></div>
      </form>
    </div>
  </section>

  <footer class="footer">
    <div class="footer__grid">
      <div class="footer__info">
        <p class="footer__project">${esc(f.project)}</p>
        <p>${esc(f.by)}</p>
        <p>${esc(f.company)}</p>
        <p>${esc(f.address)}</p>
        <p>${esc(f.registration)}</p>
        <p>Email: <a href="mailto:${esc(site.order.email)}">${esc(site.order.email)}</a></p>
        <p>Giờ làm việc: ${esc(site.order.hours)}</p>
        <p class="footer__links">${f.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</p>
      </div>
      <ul class="footer__social" role="list">
        ${f.social.map((s) => `<li><a href="${esc(s.href)}" target="_blank" rel="noopener" aria-label="${esc(s.name)}">${icon[s.name] || esc(s.name)}</a></li>`).join('\n        ')}
      </ul>
    </div>
  </footer>
</main>

<div class="sheet" data-sheet hidden>
  <div class="sheet__backdrop" data-close></div>
  <div class="sheet__box" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <button type="button" class="sheet__close" data-close aria-label="Đóng">${icon.close}</button>
    <div class="sheet__scroll" data-sheet-body></div>
  </div>
</div>

<div class="toast" data-toast role="status" aria-live="polite" hidden>
  <span data-toast-text></span>
  <a href="#dat-hang" class="toast__link">Xem đơn</a>
</div>

<script id="shop-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
${js.inline ? `<script>\n${js.inline}\n</script>` : `<script src="${js.href}" defer></script>`}
</body>
</html>
`;
}

/* ---------- chạy ---------- */

async function main() {
  const t0 = Date.now();
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  log(OFFLINE ? 'Chế độ offline: dùng ảnh giả'
    : SINGLE ? 'Bản xem trước một file: ảnh lấy thẳng từ cdn.givehada.com'
      : 'Tải ảnh sản phẩm từ cdn.givehada.com');
  if (!ORDER_ENDPOINT && !SINGLE) warnings.push('Chưa có địa chỉ nhận đơn (order.endpoint). Form sẽ báo lỗi khi gửi.');

  const A = site.assets;
  const fonts = await buildFonts(SINGLE);
  const logo = await buildImage(A.base + A.logo.path, { ...A.logo, widths: [240, 400], quality: 90, alpha: true, label: 'GIVEHADA' });

  // Ảnh sản phẩm: ảnh đầu cho thẻ, đủ bộ cho trang chi tiết
  const IMG = catalog.imageBase;
  const jobs = [];
  products.forEach((p, pi) => p.images.forEach((im, ii) => jobs.push({ p, pi, ii, url: IMG + im })));
  const built = await pool(jobs, 6, ({ p, url }) => buildImage(url, { widths: [360, 720, 1080], label: p.name }));
  const gallery = products.map(() => []);
  jobs.forEach((j, k) => { gallery[j.pi][j.ii] = built[k]; });

  const cardImgs = products.map((p, i) => gallery[i][0]);
  const featureImgs = site.signature.map((f) => gallery[products.findIndex((p) => p.sku === f.skus[0])]);

  const favicons = {};
  let og = '';
  if (!SINGLE) {
    // Favicon, biểu tượng màn hình chính
    for (const [key, a, file] of [['dark', A.faviconDark, 'favicon-dark.png'], ['light', A.faviconLight, 'favicon-light.png']]) {
      const b = await getSource(A.base + a.path);
      if (b) { await sharp(b).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(DIST, file)); favicons[key] = `/${file}`; }
    }
    const manifestIcons = [];
    {
      const b = await getSource(A.base + A.faviconDark.path);
      if (b) {
        await sharp(b).resize(180, 180, { fit: 'contain', background: '#030417' }).png().toFile(path.join(DIST, 'apple-touch-icon.png'));
        favicons.touch = '/apple-touch-icon.png';
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
      name: site.site.appName,
      short_name: site.site.shortName,
      description: site.site.description,
      lang: 'vi',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#030417',
      theme_color: '#030417',
      icons: manifestIcons,
    }, null, 2));

    // Ảnh chia sẻ 1200x630: nền đêm, ảnh sản phẩm chủ lực, logo
    og = '/og.jpg';
    const heroSku = site.signature[0].skus[0];
    const src = await getSource(IMG + bySku.get(heroSku).images[0]) || (OFFLINE ? await placeholder(1200, 1200, bySku.get(heroSku).name) : null);
    const logoBuf = await getSource(A.base + A.logo.path);
    const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
      <defs><radialGradient id="a" cx="78%" cy="45%" r="60%"><stop offset="0" stop-color="#0c41ab" stop-opacity=".55"/><stop offset="1" stop-color="#030417" stop-opacity="0"/></radialGradient></defs>
      <rect width="1200" height="630" fill="#030417"/><rect width="1200" height="630" fill="url(#a)"/></svg>`);
    const layers = [];
    if (src) {
      const shot = await sharp(src).resize(520, 520, { fit: 'cover' })
        .composite([{ input: Buffer.from('<svg width="520" height="520"><rect width="520" height="520" rx="36" ry="36"/></svg>'), blend: 'dest-in' }])
        .png().toBuffer();
      layers.push({ input: shot, left: 610, top: 55 });
    }
    if (logoBuf) {
      const lg = await sharp(logoBuf).resize({ width: 420 }).png().toBuffer();
      const lm = await sharp(lg).metadata();
      layers.push({ input: lg, left: 90, top: Math.round(315 - lm.height / 2) });
    }
    if (layers.length) {
      await sharp(bg).composite(layers).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(DIST, 'og.jpg'));
    } else {
      og = IMG + bySku.get(heroSku).images[0];
    }
  }

  // Dữ liệu cho script trên trang: chỉ những gì cần để tính đơn và hiện chi tiết
  const data = {
    endpoint: SINGLE ? '' : ORDER_ENDPOINT,
    preview: SINGLE,
    currency: site.order.currency,
    maxQty: site.order.maxQty,
    hours: site.order.hours,
    zalo: site.order.zalo,
    email: site.order.email,
    products: Object.fromEntries(products.map((p, i) => [p.sku, {
      name: p.name, brand: p.brand, type: p.type, benefit: p.benefit, forWhom: p.forWhom, usage: p.usage,
      ingredients: p.ingredients, contents: p.contents || [], size: p.size, price: p.price,
      images: gallery[i].map((g) => ({ src: g.src, srcset: g.srcset, w: g.w, h: g.h })),
    }])),
  };

  // CSS, JS: bản thường tách file có hash để cache lâu dài, bản một file nhúng thẳng vào HTML
  const cssText = `${fonts.css}\n${await readFile(path.join(SRC, 'styles.css'), 'utf8')}`;
  const jsText = await readFile(path.join(SRC, 'app.js'), 'utf8');
  const css = SINGLE ? { inline: cssText } : { href: await writeHashed('site', 'css', cssText) };
  const js = SINGLE ? { inline: jsText } : { href: await writeHashed('app', 'js', jsText) };

  const html = renderPage({ css, js, fontPreload: fonts.preload, logo, featureImgs, cardImgs, favicons, og, data });
  await writeFile(path.join(DIST, 'index.html'), html);
  if (!SINGLE) {
    await writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
    if (origin) {
      await writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`);
    }
  }

  const remote = built.filter((b) => b.remote).length;
  log(`Xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s. ${products.length} sản phẩm, ${built.length} ảnh, ${remote} ảnh dùng thẳng CDN gốc.`);
  if (SINGLE) log(`Bản một file: ${path.join(DIST, 'index.html')} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
  if (warnings.length) {
    console.warn('[build] Cảnh báo:');
    for (const w of warnings.slice(0, 20)) console.warn('  ', w);
    if (warnings.length > 20) console.warn(`   ... và ${warnings.length - 20} cảnh báo khác`);
  }
}

await main();
