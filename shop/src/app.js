(() => {
  clearTimeout(window.__shopFallback);
  const DATA = JSON.parse(document.getElementById('shop-data').textContent);
  const P = DATA.products;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phone = window.matchMedia('(max-width: 719px)');
  const loadedAt = Date.now();

  const esc = (s = '') => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (n) => `${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${DATA.currency}`;

  // Bộ nhớ trình duyệt có thể bị chặn (chế độ ẩn danh, trình duyệt trong app): luôn bọc try.
  const store = {
    get(k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const sess = {
    get(k) { try { return JSON.parse(window.sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { window.sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const icons = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  /* ---------- ảnh không tải được: khung thay thế gọn gàng ---------- */
  const markFailed = (img) => {
    if (!img || img.dataset.failed) return;
    img.dataset.failed = '1';
    if (img.dataset.wordmark) {
      const mark = document.createElement('span');
      mark.className = img.dataset.wordmark;
      mark.textContent = img.alt || 'GIVEHADA';
      img.replaceWith(mark);
      return;
    }
    const box = img.closest('[data-label]');
    if (box) box.classList.add('media-fallback');
  };
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') markFailed(e.target);
  }, true);
  document.querySelectorAll('img').forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) markFailed(img);
  });

  /* ---------- nguồn truy cập (quảng cáo, đường dẫn) ---------- */
  const SRC_KEY = 'ghshop.src';
  if (!sess.get(SRC_KEY)) {
    const q = new URLSearchParams(window.location.search);
    const src = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => { if (q.get(k)) src[k] = q.get(k).slice(0, 100); });
    if (q.get('fbclid')) src.fbclid = 'yes';
    if (document.referrer && !document.referrer.startsWith(window.location.origin)) src.referrer = document.referrer.slice(0, 200);
    sess.set(SRC_KEY, src);
  }

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
      const count = Math.min(phone.matches ? 130 : 280, Math.round((w * h) / 5400));
      stars = Array.from({ length: count }, () => {
        const big = Math.random() > 0.88;
        return {
          x: Math.random() * w, y: Math.random() * h,
          r: big ? 0.9 + Math.random() * 0.8 : 0.35 + Math.random() * 0.55,
          a: 0.25 + Math.random() * 0.6, p: Math.random() * Math.PI * 2,
          s: 0.4 + Math.random() * 1.3, blue: Math.random() < 0.3,
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
      if (t - last < 66) return;
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
        if (Math.abs(window.innerWidth - lastW) < 2) return;
        lastW = window.innerWidth;
        seed();
        draw(performance.now());
      }, 180);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  }

  /* ---------- thanh chuyển phần ---------- */
  const bar = document.querySelector('[data-topbar]');
  const hero = document.querySelector('[data-hero]');
  const links = Array.from(document.querySelectorAll('[data-nav]'));
  if (bar && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      bar.classList.toggle('is-visible', e.intersectionRatio < 0.3);
    }, { threshold: [0, 0.3, 0.6, 1] }).observe(hero);
    const setActive = (key) => links.forEach((a) => {
      const on = a.dataset.nav === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    const so = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.dataset.section); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('[data-section]').forEach((s) => so.observe(s));
  } else if (bar) {
    bar.classList.add('is-visible');
  }

  /* ---------- hiệu ứng xuất hiện ---------- */
  const pending = new Set(document.querySelectorAll('.reveal, .pgrid'));
  const show = (el) => { el.classList.add('is-in'); pending.delete(el); };
  if ('IntersectionObserver' in window && !reduce.matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px' });
    pending.forEach((el) => io.observe(el));
    // Trình duyệt trong app (Zalo, Messenger) đôi khi báo trễ: phần nào đã trong màn hình thì hiện luôn.
    let ticking = false;
    const sweep = () => {
      ticking = false;
      const limit = window.innerHeight * 1.02;
      pending.forEach((el) => { if (el.getBoundingClientRect().top < limit) show(el); });
      if (!pending.size) window.removeEventListener('scroll', onScroll);
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(sweep); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', () => setTimeout(sweep, 400));
    setTimeout(sweep, 600);
  } else {
    pending.forEach(show);
  }

  /* ---------- thông báo nhỏ ---------- */
  const toastEl = document.querySelector('[data-toast]');
  const toastText = toastEl && toastEl.querySelector('[data-toast-text]');
  let toastTimer;
  const toast = (msg) => {
    if (!toastEl) return;
    toastText.textContent = msg;
    toastEl.hidden = true;
    void toastEl.offsetWidth;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2800);
  };

  /* ---------- đơn hàng ---------- */
  const CART_KEY = 'ghshop.cart.v1';
  const clampQty = (q, min = 1) => Math.max(min, Math.min(DATA.maxQty, parseInt(q, 10) || 0));
  const sanitize = (c) => {
    const out = {};
    Object.entries(c || {}).forEach(([sku, q]) => { if (P[sku]) { const n = clampQty(q, 0); if (n) out[sku] = n; } });
    return out;
  };
  let cart = sanitize(store.get(CART_KEY, {}));
  const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const subtotal = () => Object.entries(cart).reduce((s, [sku, q]) => s + P[sku].price * q, 0);

  const listEl = document.querySelector('[data-cart-list]');
  const emptyEl = document.querySelector('[data-cart-empty]');
  const sumEl = document.querySelector('[data-cart-sum]');
  const subEl = document.querySelector('[data-subtotal]');
  const clearBtn = document.querySelector('[data-clear]');
  const badges = Array.from(document.querySelectorAll('[data-count]'));
  const form = document.querySelector('[data-form]');
  const consultBox = document.querySelector('[data-consult-box]');
  const submitBtn = document.querySelector('[data-submit]');

  const updateSubmitLabel = () => {
    if (!submitBtn || submitBtn.disabled) return;
    const consultOnly = !count() && consultBox && consultBox.checked;
    submitBtn.textContent = consultOnly ? submitBtn.dataset.labelConsult : submitBtn.dataset.label;
  };

  const imgHtml = (im, { sizes, alt = '', lazy = true }) =>
    `<img src="${esc(im.src)}"${im.srcset ? ` srcset="${esc(im.srcset)}" sizes="${sizes}"` : ''} width="${im.w}" height="${im.h}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer">`;

  const thumb = (sku) => {
    const im = (P[sku].images || [])[0];
    return `<span class="cart__thumb" data-label="">${im ? imgHtml(im, { sizes: '56px' }) : ''}</span>`;
  };

  const renderCart = () => {
    const entries = Object.entries(cart);
    if (listEl) {
      listEl.innerHTML = entries.map(([sku, q]) => {
        const p = P[sku];
        return `<li class="cart__item">
          ${thumb(sku)}
          <div class="cart__info"><p class="cart__name">${esc(p.name)}</p><p class="cart__meta">${esc(p.size)}, ${money(p.price)}</p></div>
          <button type="button" class="cart__rm" data-rm="${esc(sku)}" aria-label="Bỏ ${esc(p.name)} khỏi đơn">${icons.close}</button>
          <div class="cart__ctl">
            <div class="qty qty--sm" data-cart-sku="${esc(sku)}">
              <button type="button" class="qty__btn" data-step="-1" aria-label="Bớt một ${esc(p.name)}">${icons.minus}</button>
              <input class="qty__input" type="number" inputmode="numeric" min="0" max="${DATA.maxQty}" value="${q}" aria-label="Số lượng ${esc(p.name)}">
              <button type="button" class="qty__btn" data-step="1" aria-label="Thêm một ${esc(p.name)}">${icons.plus}</button>
            </div>
            <span class="cart__line">${money(p.price * q)}</span>
          </div>
        </li>`;
      }).join('');
    }
    const n = count();
    if (emptyEl) emptyEl.hidden = n > 0;
    if (sumEl) sumEl.hidden = n === 0;
    if (clearBtn) clearBtn.hidden = n === 0;
    if (subEl) subEl.textContent = money(subtotal());
    badges.forEach((b) => { b.textContent = String(n); b.hidden = n === 0; });
    const cartErr = document.querySelector('[data-err="cart"]');
    if (n && cartErr) cartErr.classList.remove('is-on');
    updateSubmitLabel();
  };

  const persist = () => { store.set(CART_KEY, cart); renderCart(); };
  const setQty = (sku, q) => {
    if (!P[sku]) return;
    const n = clampQty(q, 0);
    if (n) cart[sku] = n; else delete cart[sku];
    persist();
  };
  const bump = () => badges.forEach((b) => { b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); });
  const add = (sku, q = 1) => {
    if (!P[sku]) return;
    setQty(sku, (cart[sku] || 0) + clampQty(q));
    bump();
  };
  const flash = (btn) => {
    btn.classList.add('is-added');
    setTimeout(() => btn.classList.remove('is-added'), 900);
  };

  renderCart();
  window.addEventListener('storage', (e) => { if (e.key === CART_KEY) { cart = sanitize(store.get(CART_KEY, {})); renderCart(); } });

  /* ---------- bộ lọc ---------- */
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const cards = Array.from(document.querySelectorAll('.pcard'));
  const applyFilter = (id) => {
    filters.forEach((f) => {
      const on = f.dataset.filter === id;
      f.classList.toggle('is-on', on);
      f.setAttribute('aria-pressed', String(on));
    });
    cards.forEach((c) => { c.hidden = !(id === 'all' || c.dataset.cat === id); });
  };

  /* ---------- trang chi tiết ---------- */
  const sheet = document.querySelector('[data-sheet]');
  const sheetBody = sheet && sheet.querySelector('[data-sheet-body]');
  const sheetClose = sheet && sheet.querySelector('.sheet__close');
  let opener = null;

  const block = (title, html) => `<section class="pd__block"><h3>${title}</h3>${html}</section>`;

  const openSheet = (sku, from) => {
    const p = P[sku];
    if (!p || !sheet) return;
    opener = from || null;
    const slides = (p.images || []).map((im, i) =>
      `<figure class="pd__slide" data-label="${esc(p.name)}">${imgHtml(im, { sizes: '(min-width: 900px) 520px, 100vw', alt: `${p.name}${i ? `, ảnh ${i + 1}` : ''}`, lazy: i > 0 })}</figure>`).join('');
    const dots = p.images.length > 1
      ? `<div class="pd__dots">${p.images.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Ảnh ${i + 1}"${i ? '' : ' class="is-on"'}></button>`).join('')}</div>`
      : '';
    sheetBody.innerHTML = `<article class="pd">
      <div class="pd__gallery"><div class="pd__track" data-track>${slides}</div>${dots}</div>
      <div class="pd__info">
        <p class="pd__brand">${esc(p.brand)}</p>
        <h2 class="pd__name" id="sheet-title">${esc(p.name)}</h2>
        <p class="pd__type">${esc(p.type)}</p>
        <p class="pd__price">${money(p.price)}<span>${esc(p.size)}</span></p>
        <p class="pd__benefit">${esc(p.benefit)}</p>
        ${p.forWhom ? block('Dành cho', `<p>${esc(p.forWhom)}</p>`) : ''}
        ${p.usage ? block('Cách dùng', `<p>${esc(p.usage)}</p>`) : ''}
        ${p.contents && p.contents.length ? block('Trong hộp', `<ul>${p.contents.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`) : ''}
        ${p.ingredients && p.ingredients.length ? block('Thành phần nổi bật', `<ul class="chips" role="list">${p.ingredients.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`) : ''}
        <div class="pd__buy">
          <div class="qty" data-qty="sheet">
            <button type="button" class="qty__btn" data-step="-1" aria-label="Bớt một">${icons.minus}</button>
            <input class="qty__input" type="number" inputmode="numeric" min="1" max="${DATA.maxQty}" value="1" aria-label="Số lượng">
            <button type="button" class="qty__btn" data-step="1" aria-label="Thêm một">${icons.plus}</button>
          </div>
          <button type="button" class="btn btn--gold" data-add-sheet="${esc(sku)}">${icons.bag}<span>Thêm vào đơn</span></button>
        </div>
      </div>
    </article>`;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    sheetBody.scrollTop = 0;
    const track = sheetBody.querySelector('[data-track]');
    const dotEls = Array.from(sheetBody.querySelectorAll('[data-dot]'));
    if (track && dotEls.length) {
      track.addEventListener('scroll', () => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        dotEls.forEach((d, k) => d.classList.toggle('is-on', k === i));
      }, { passive: true });
    }
    if (sheetClose) sheetClose.focus({ preventScroll: true });
  };

  const closeSheet = () => {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    sheetBody.innerHTML = '';
    document.body.classList.remove('is-locked');
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  };

  /* ---------- bấm ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;

    const addBtn = t.closest('[data-add]');
    if (addBtn) {
      const sku = addBtn.dataset.add;
      add(sku, 1);
      flash(addBtn);
      toast(`Đã thêm ${P[sku].name}`);
      return;
    }

    const setBtn = t.closest('[data-add-set]');
    if (setBtn) {
      setBtn.dataset.addSet.split(',').forEach((pair) => {
        const [sku, q] = pair.split(':');
        if (P[sku]) cart[sku] = clampQty((cart[sku] || 0) + (parseInt(q, 10) || 1), 0);
      });
      persist();
      bump();
      toast('Đã thêm cả liệu trình vào đơn');
      return;
    }

    const featBtn = t.closest('[data-add-feature]');
    if (featBtn) {
      const art = featBtn.closest('[data-feature]');
      const on = art.querySelector('[data-variant].is-on');
      const sku = on ? on.dataset.variant : art.dataset.feature;
      const input = art.querySelector('.qty__input');
      const q = clampQty(input ? input.value : 1);
      add(sku, q);
      if (input) input.value = '1';
      toast(`Đã thêm ${q > 1 ? `${q} x ` : ''}${P[sku].name}`);
      return;
    }

    const sheetAdd = t.closest('[data-add-sheet]');
    if (sheetAdd) {
      const sku = sheetAdd.dataset.addSheet;
      const input = sheet.querySelector('.qty__input');
      const q = clampQty(input ? input.value : 1);
      add(sku, q);
      closeSheet();
      toast(`Đã thêm ${q > 1 ? `${q} x ` : ''}${P[sku].name}`);
      return;
    }

    const variant = t.closest('[data-variant]');
    if (variant) {
      const art = variant.closest('[data-feature]');
      art.querySelectorAll('[data-variant]').forEach((v) => {
        const on = v === variant;
        v.classList.toggle('is-on', on);
        v.setAttribute('aria-checked', String(on));
      });
      const price = art.querySelector('[data-price-out]');
      const size = art.querySelector('[data-size-out]');
      if (price) price.textContent = money(variant.dataset.price);
      if (size) size.textContent = variant.dataset.size;
      return;
    }

    const step = t.closest('.qty__btn');
    if (step) {
      const wrap = step.closest('.qty');
      const input = wrap.querySelector('.qty__input');
      const cartSku = wrap.dataset.cartSku;
      const next = (parseInt(input.value, 10) || 0) + Number(step.dataset.step);
      if (cartSku) { setQty(cartSku, next); return; }
      input.value = String(clampQty(next));
      return;
    }

    const rm = t.closest('[data-rm]');
    if (rm) { setQty(rm.dataset.rm, 0); return; }

    if (t.closest('[data-clear]')) { cart = {}; persist(); return; }

    const dot = t.closest('[data-dot]');
    if (dot) {
      const track = sheet.querySelector('[data-track]');
      if (track) track.scrollTo({ left: track.clientWidth * Number(dot.dataset.dot), behavior: reduce.matches ? 'auto' : 'smooth' });
      return;
    }

    const open = t.closest('[data-open]');
    if (open) { openSheet(open.dataset.open, open); return; }

    const filter = t.closest('[data-filter]');
    if (filter) { applyFilter(filter.dataset.filter); return; }

    const consult = t.closest('[data-consult]');
    if (consult && consultBox) {
      consultBox.checked = true;
      updateSubmitLabel();
      return;
    }

    if (t.closest('[data-close]')) closeSheet();
    if (t.closest('.toast__link') && toastEl) toastEl.hidden = true;
  });

  document.addEventListener('change', (e) => {
    const input = e.target.closest('.qty__input');
    if (input) {
      const wrap = input.closest('.qty');
      if (wrap.dataset.cartSku) setQty(wrap.dataset.cartSku, input.value);
      else input.value = String(clampQty(input.value));
    }
    if (e.target === consultBox) updateSubmitLabel();
  });

  document.addEventListener('keydown', (e) => {
    if (!sheet || sheet.hidden) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Tab') {
      const items = Array.from(sheet.querySelectorAll('button, input, a[href]')).filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- gửi đơn ---------- */
  if (form) {
    const status = form.querySelector('[data-status]');
    const fields = {
      name: form.querySelector('[name="name"]'),
      phone: form.querySelector('[name="phone"]'),
      address: form.querySelector('[name="address"]'),
      note: form.querySelector('[name="note"]'),
      website: form.querySelector('[name="website"]'),
    };

    const normPhone = (v) => {
      let s = String(v || '').trim().replace(/[^\d+]/g, '');
      if (s.startsWith('+84')) s = `0${s.slice(3)}`;
      else if (s.startsWith('84') && s.length === 11) s = `0${s.slice(2)}`;
      return s.replace(/\D/g, '');
    };
    const setInvalid = (key, bad) => {
      const field = fields[key] && fields[key].closest('.field');
      if (field) field.classList.toggle('is-invalid', bad);
      if (fields[key]) fields[key].setAttribute('aria-invalid', String(bad));
    };

    const validate = () => {
      const name = fields.name.value.trim();
      const phoneNum = normPhone(fields.phone.value);
      const address = fields.address.value.trim();
      const errors = {
        name: name.length < 2,
        phone: !/^0\d{9,10}$/.test(phoneNum),
        address: address.length < 6,
      };
      Object.entries(errors).forEach(([k, bad]) => setInvalid(k, bad));
      const cartErr = form.querySelector('[data-err="cart"]');
      const noCart = !count() && !(consultBox && consultBox.checked);
      if (cartErr) cartErr.classList.toggle('is-on', noCart);
      const firstBad = ['name', 'phone', 'address'].find((k) => errors[k]);
      if (firstBad) { fields[firstBad].focus(); return null; }
      if (noCart) return null;
      return { name, phone: phoneNum, address };
    };

    ['name', 'phone', 'address'].forEach((k) => {
      fields[k].addEventListener('input', () => {
        const field = fields[k].closest('.field');
        if (field && field.classList.contains('is-invalid')) setInvalid(k, false);
      });
    });

    const makeId = () => {
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const rnd = new Uint32Array(4);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(rnd);
      else rnd.forEach((_, i) => { rnd[i] = Math.floor(Math.random() * 1e9); });
      let r = '';
      rnd.forEach((x) => { r += abc[x % abc.length]; });
      return `WEB${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}${r}`;
    };

    const showStatus = (kind, html) => {
      status.className = `form__status is-${kind}`;
      status.innerHTML = html;
      status.hidden = false;
    };

    const errorHtml = (msg) => `<strong>Chưa gửi được đơn.</strong>${esc(msg)} Bạn có thể thử lại, hoặc nhắn <a href="${esc(DATA.zalo)}" target="_blank" rel="noopener">Zalo GIVEHADA</a> để được hỗ trợ ngay.`;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      status.hidden = true;
      const customer = validate();
      if (!customer) return;

      const consult = Boolean(consultBox && consultBox.checked);
      const items = Object.entries(cart).map(([sku, qty]) => ({ sku, name: P[sku].name, size: P[sku].size, qty, price: P[sku].price }));
      const orderId = makeId();
      const done = (id) => {
        const previewNote = DATA.preview
          ? `<p class="form__preview">Bản xem trước: đơn chưa được gửi đi. Khi lên Vercel, đơn sẽ về Google Sheet và email ${esc(DATA.email)}.</p>`
          : '';
        showStatus('ok', `<strong>Đã nhận ${items.length ? 'đơn' : 'yêu cầu'} ${esc(id)}.</strong>Cảm ơn ${esc(customer.name)}. Chuyên viên GIVEHADA sẽ gọi số ${esc(customer.phone)} để xác nhận, trong giờ làm việc ${esc(DATA.hours)}.${previewNote}`);
        form.classList.add('is-done');
        cart = {};
        persist();
        form.reset();
        status.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' });
      };

      // Ô ẩn chỉ máy dò điền: coi như đã gửi, không đẩy đi đâu.
      if (fields.website && fields.website.value) { done(orderId); return; }
      if (DATA.preview) { done(orderId); return; }
      if (Date.now() - loadedAt < 2500) { showStatus('err', errorHtml('Thao tác quá nhanh, vui lòng thử lại sau vài giây.')); return; }
      if (!DATA.endpoint) { showStatus('err', errorHtml('Hệ thống nhận đơn đang được kết nối.')); return; }

      const payload = {
        orderId,
        createdAt: new Date().toISOString(),
        customer,
        note: fields.note.value.trim().slice(0, 500),
        consult,
        items,
        subtotal: subtotal(),
        source: sess.get(SRC_KEY) || {},
        page: window.location.href.split('#')[0].slice(0, 300),
        ua: navigator.userAgent.slice(0, 200),
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang gửi...';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        // Gửi dạng text/plain để không phát sinh yêu cầu kiểm tra trước (preflight) với Google Apps Script
        const res = await fetch(DATA.endpoint, { method: 'POST', body: JSON.stringify(payload), signal: ctrl.signal, redirect: 'follow' });
        const out = await res.json().catch(() => ({}));
        if (out && out.ok) done(out.orderId || orderId);
        else showStatus('err', errorHtml(out && out.message ? `${out.message} ` : 'Máy chủ chưa phản hồi đúng. '));
      } catch (err) {
        showStatus('err', errorHtml(err && err.name === 'AbortError' ? 'Kết nối quá chậm. ' : 'Kết nối mạng gián đoạn. '));
      } finally {
        clearTimeout(timer);
        submitBtn.disabled = false;
        updateSubmitLabel();
      }
    });
  }
})();
