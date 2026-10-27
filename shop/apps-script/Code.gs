/**
 * Nhận đơn từ trang Pharmesthetic Homecare (givehada-shop.vercel.app).
 * Ghi đơn vào Google Sheet "GIVEHADA Homecare | Đơn web" và gửi email báo đơn mới.
 *
 * Triển khai: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Dán URL web app vào shop/content/site.json, mục order.endpoint.
 */

const SHEET_ID = '1Lba9W2gbDLvjUg7R_8_SoGlZSV_BnLzFdM1lw4WP23o';
const ORDERS_TAB = 'Đơn hàng';
const PRICES_TAB = 'Bảng giá';
const NOTIFY_TO = 'givehada@h2yjsc.com';
const MAX_ITEMS = 30;
const MAX_QTY = 20;

function doGet() {
  return json_({ ok: true, service: 'givehada-shop-orders' });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, message: 'Dữ liệu không hợp lệ.' });
  }

  // Ô ẩn chống máy dò: báo thành công nhưng không ghi gì.
  if (data.website) return json_({ ok: true, orderId: String(data.orderId || '') });

  const c = data.customer || {};
  const name = clean_(c.name, 80);
  const phone = normPhone_(c.phone);
  const address = clean_(c.address, 300);
  const note = clean_(data.note, 500);
  const consult = data.consult === true;
  if (name.length < 2 || !/^0\d{9,10}$/.test(phone) || address.length < 6) {
    return json_({ ok: false, message: 'Thông tin liên hệ chưa đúng.' });
  }

  // Tối đa 5 đơn mỗi 30 phút cho một số điện thoại.
  const cache = CacheService.getScriptCache();
  const rateKey = 'rate_' + phone;
  const hits = Number(cache.get(rateKey) || 0);
  if (hits >= 5) {
    return json_({ ok: false, message: 'Bạn đã gửi nhiều đơn liên tiếp, chuyên viên sẽ liên hệ sớm.' });
  }
  cache.put(rateKey, String(hits + 1), 1800);

  // Giá lấy từ tab Bảng giá, không lấy giá trình duyệt gửi lên.
  const prices = loadPrices_();
  const items = [];
  (Array.isArray(data.items) ? data.items : []).slice(0, MAX_ITEMS).forEach(function (it) {
    const sku = String((it && it.sku) || '').trim().toUpperCase();
    const p = prices[sku];
    if (!p) return;
    const qty = Math.max(1, Math.min(MAX_QTY, parseInt(it.qty, 10) || 1));
    items.push({ sku: sku, name: p.name, size: p.size, qty: qty, price: p.price, amount: p.price * qty });
  });
  if (!items.length && !consult) return json_({ ok: false, message: 'Đơn hàng đang trống.' });

  const orderId = /^WEB\d{6}[A-Z0-9]{4}$/.test(String(data.orderId || '')) ? String(data.orderId) : makeId_();
  const total = items.reduce(function (s, it) { return s + it.amount; }, 0);
  const qtyAll = items.reduce(function (s, it) { return s + it.qty; }, 0);
  const itemsText = items.map(function (it) { return it.qty + ' x ' + it.name + ' (' + it.sku + ', ' + it.size + ')'; }).join('\n');
  const src = data.source || {};
  const srcText = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'referrer']
    .filter(function (k) { return src[k]; })
    .map(function (k) { return k + '=' + clean_(src[k], 200); })
    .join('\n');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ORDERS_TAB);
    // Khách bấm gửi hai lần: không ghi trùng.
    const last = sh.getLastRow();
    if (last >= 2) {
      const from = Math.max(2, last - 40);
      const ids = sh.getRange(from, 2, last - from + 1, 1).getValues().map(function (r) { return String(r[0]); });
      if (ids.indexOf(orderId) !== -1) return json_({ ok: true, orderId: orderId, duplicate: true });
    }
    sh.appendRow([
      new Date(), orderId, name, "'" + phone, address, itemsText || '(chỉ cần tư vấn)', qtyAll, total,
      note, consult ? 'Có' : '', srcText, clean_(data.page, 300), 'Mới', '', '',
    ]);
  } finally {
    lock.releaseLock();
  }

  try {
    notify_({ orderId: orderId, name: name, phone: phone, address: address, note: note, consult: consult, items: items, total: total, srcText: srcText });
  } catch (err) {
    console.error('Gửi email báo đơn lỗi: ' + err);
  }
  return json_({ ok: true, orderId: orderId });
}

/* ---------- tiện ích ---------- */

function loadPrices_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('prices');
  if (hit) return JSON.parse(hit);
  const rows = SpreadsheetApp.openById(SHEET_ID).getSheetByName(PRICES_TAB).getDataRange().getValues().slice(1);
  const out = {};
  rows.forEach(function (r) {
    const sku = String(r[0] || '').trim().toUpperCase();
    const price = Number(r[3]);
    if (sku && price > 0) out[sku] = { name: String(r[1]), size: String(r[2]), price: price };
  });
  cache.put('prices', JSON.stringify(out), 600);
  return out;
}

function notify_(o) {
  const money = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ'; };
  const rows = o.items.map(function (it) {
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">' + esc_(it.name) + '<br><small style="color:#777">' + esc_(it.sku) + ', ' + esc_(it.size) + '</small></td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">' + it.qty + '</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">' + money(it.amount) + '</td></tr>';
  }).join('');
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">'
    + '<h2 style="margin:0 0 6px">Đơn web ' + esc_(o.orderId) + '</h2>'
    + '<p style="margin:0 0 14px;color:#555">Pharmesthetic Homecare, gọi xác nhận trong giờ làm việc.</p>'
    + '<p><b>Khách:</b> ' + esc_(o.name) + '<br><b>Số điện thoại:</b> ' + esc_(o.phone) + '<br><b>Địa chỉ:</b> ' + esc_(o.address) + '</p>'
    + (o.consult ? '<p><b>Cần tư vấn chọn sản phẩm.</b></p>' : '')
    + (o.note ? '<p><b>Ghi chú:</b> ' + esc_(o.note) + '</p>' : '')
    + (o.items.length ? '<table style="border-collapse:collapse;min-width:320px">' + rows
      + '<tr><td style="padding:8px 10px"><b>Tạm tính</b></td><td></td><td style="padding:8px 10px;text-align:right"><b>' + money(o.total) + '</b></td></tr></table>' : '')
    + (o.srcText ? '<p style="color:#777;font-size:12px;white-space:pre-line">Nguồn: ' + esc_(o.srcText) + '</p>' : '')
    + '<p><a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit">Mở bảng đơn</a></p></div>';
  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: '[Đơn web] ' + o.orderId + ' | ' + o.name + ' | ' + (o.items.length ? money(o.total) : 'Cần tư vấn'),
    htmlBody: html,
    name: 'Pharmesthetic Homecare',
  });
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/^[=+\-@]+/, '').trim().slice(0, max);
}

function normPhone_(v) {
  let s = String(v || '').trim().replace(/[^\d+]/g, '');
  if (s.indexOf('+84') === 0) s = '0' + s.slice(3);
  else if (s.indexOf('84') === 0 && s.length === 11) s = '0' + s.slice(2);
  return s.replace(/\D/g, '');
}

function makeId_() {
  const d = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyMMdd');
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 4; i++) r += abc.charAt(Math.floor(Math.random() * abc.length));
  return 'WEB' + d + r;
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Chạy tay một lần trong trình soạn Apps Script để cấp quyền và thử gửi email. */
function testNotify() {
  notify_({ orderId: 'WEB000000TEST', name: 'Đơn thử', phone: '0900000000', address: 'Địa chỉ thử', note: 'Kiểm tra email báo đơn', consult: false,
    items: [{ sku: 'VQM12', name: 'Vibanqm Lotion', size: '30ml', qty: 1, price: 2060000, amount: 2060000 }], total: 2060000, srcText: '' });
}
