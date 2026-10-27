(() => {
  clearTimeout(window.__pmhFallback);
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phone = window.matchMedia('(max-width: 719px)');
  const conn = navigator.connection || {};
  const lowData = Boolean(conn.saveData) || /(^|-)2g|3g/.test(conn.effectiveType || '');

  /* ---------- bầu trời sao ---------- */
  const sky = document.querySelector('.sky');
  if (sky && sky.getContext) {
    const ctx = sky.getContext('2d');
    let w = 0, h = 0, stars = [], raf = 0, last = 0;

    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = sky.clientWidth;
      h = sky.clientHeight;
      sky.width = Math.round(w * dpr);
      sky.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(phone.matches ? 140 : 300, Math.round((w * h) / 5200));
      stars = Array.from({ length: count }, () => {
        const big = Math.random() > 0.88;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: big ? 0.9 + Math.random() * 0.8 : 0.35 + Math.random() * 0.55,
          a: 0.25 + Math.random() * 0.6,
          p: Math.random() * Math.PI * 2,
          s: 0.4 + Math.random() * 1.3,
          blue: Math.random() < 0.3,
        };
      });
    };

    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        const tw = reduce.matches ? 1 : 0.55 + 0.45 * Math.sin(st.p + t * 0.001 * st.s);
        ctx.globalAlpha = st.a * tw;
        ctx.fillStyle = st.blue ? '#86b6ff' : '#ffffff';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 66) return; // khoảng 15 khung hình mỗi giây là đủ cho sao nhấp nháy, đỡ tốn pin
      last = t;
      draw(t);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches) { draw(0); return; }
      raf = requestAnimationFrame(loop);
    };

    seed();
    start();

    let lastW = window.innerWidth;
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Điện thoại đổi chiều cao khi thanh địa chỉ ẩn hiện, chỉ vẽ lại khi đổi chiều rộng
        if (Math.abs(window.innerWidth - lastW) < 2) return;
        lastW = window.innerWidth;
        seed();
        draw(performance.now());
      }, 180);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    });
    if (reduce.addEventListener) reduce.addEventListener('change', start);
  }

  /* ---------- video nền ---------- */
  const video = document.querySelector('.hero__video');
  if (video && !reduce.matches && !lowData) {
    video.src = phone.matches ? video.dataset.srcM : video.dataset.srcD;
    video.muted = true;
    video.addEventListener('playing', () => video.classList.add('is-playing'), { once: true });
    const play = () => {
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => (e.isIntersecting ? play() : video.pause()), { threshold: 0.05 }).observe(video);
    } else {
      play();
    }
  }

  /* ---------- thanh chuyển phần ---------- */
  const bar = document.querySelector('[data-topbar]');
  const hero = document.querySelector('[data-hero]');
  const nav = bar && bar.querySelector('.topbar__nav');
  const links = Array.from(document.querySelectorAll('[data-nav]'));

  if (bar && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      bar.classList.toggle('is-visible', e.intersectionRatio < 0.25);
    }, { threshold: [0, 0.25, 0.5, 1] }).observe(hero);

    const setActive = (key) => {
      links.forEach((a) => {
        const on = a.dataset.nav === key;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
        if (on && nav && nav.scrollWidth > nav.clientWidth) {
          nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.clientWidth) / 2, behavior: 'smooth' });
        }
      });
    };

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.dataset.session); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('[data-session]').forEach((s) => sectionObserver.observe(s));
  } else if (bar) {
    bar.classList.add('is-visible');
  }

  /* ---------- hiệu ứng xuất hiện ---------- */
  const revealables = document.querySelectorAll('.reveal, .grid');
  if ('IntersectionObserver' in window && !reduce.matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- xem video trong trang ---------- */
  const player = document.querySelector('[data-player]');
  if (player) {
    const frame = player.querySelector('.player__frame');
    const title = player.querySelector('.player__title');
    const ext = player.querySelector('[data-player-ext]');
    const closeBtn = player.querySelector('button[data-close]');
    let opener = null;

    const open = (link) => {
      opener = link;
      const id = link.dataset.video;
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
      iframe.title = link.dataset.title || 'Video';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      frame.replaceChildren(iframe);
      title.textContent = link.dataset.title || '';
      ext.href = link.href;
      player.hidden = false;
      document.body.classList.add('is-locked');
      if (video) video.pause();
      closeBtn.focus({ preventScroll: true });
    };

    const close = () => {
      if (player.hidden) return;
      player.hidden = true;
      frame.replaceChildren();
      document.body.classList.remove('is-locked');
      if (opener) opener.focus({ preventScroll: true });
    };

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-video]');
      if (link && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        open(link);
        return;
      }
      if (e.target.closest('[data-close]')) close();
    });

    document.addEventListener('keydown', (e) => {
      if (player.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const items = [ext, closeBtn, frame.querySelector('iframe')].filter(Boolean);
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    });
  }
})();
