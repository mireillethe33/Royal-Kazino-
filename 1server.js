// Lucky Royale — сервер для Telegram Mini App. Без зависимостей, Node 18+.
// Запуск: BOT_TOKEN=... ADMIN_IDS=123456789 WEBAPP_URL=https://ваш-домен node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '8944919667:AAGmiAACDftIDM69XxWN-qiRbjOgTNHuhVk';
const ADMIN_IDS = process.env.ADMIN_IDS || '7733792615';
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || '';
const DB_FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
let db = { users: {}, admins: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
const mergeAdmins = () => { db.users = db.users || {}; db.admins = [...new Set([...(db.admins || []), ...ADMIN_IDS.split(',').map(x => x.trim()).filter(Boolean)])]; };
mergeAdmins();
let dirty = 0;
let changed = 0;
const save = () => { dirty = 1; changed = 1; };
setInterval(() => { if (dirty) { dirty = 0; fs.writeFile(DB_FILE, JSON.stringify(db), () => {}); } }, 2000);
const isAdmin = id => db.admins.includes(String(id));
const ITEMS = ['ang','dev','drk','cnf','gch','sta','inr','mic','box','stk','tz','tm'];
const BASE = ['money','wc','shield','double','insure','boost','betup','luckup','eye','hand','reset'];

// ---- проверка подписи Telegram initData ----
function auth(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash'); p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', key).update(str).digest('hex');
  if (!hash || calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 7 * 86400) return null;
  let u; try { u = JSON.parse(p.get('user')); } catch (e) { return null; }
  if (!u || !u.id) return null;
  const rec = db.users[u.id] || (db.users[u.id] = { id: u.id, st: null, ban: 0, grants: [] });
  rec.username = (u.username || '').toLowerCase(); rec.name = u.first_name || u.username || String(u.id); rec.seen = Date.now();
  return rec;
}
const find = (q, me) => {
  q = String(q || '').trim(); if (q === 'me') return me;
  if (/^\d+$/.test(q)) return db.users[q];
  return Object.values(db.users).find(u => u.username && u.username === q.replace(/^@/, '').toLowerCase());
};
const nm = u => u.username ? '@' + u.username : u.name + '#' + u.id;
const grant = (u, item, n) => { u.grants.push({ item, n }); save(); };

// ---- админ-команды (только для ADMIN_IDS) ----
function adminCmd(me, raw) {
  const a = raw.trim().split(/\s+/), c = a[0].toLowerCase(), N = Math.floor(+a[a.length - 1]);
  const U = () => find(a[1], me), need = u => u || null;
  const users = Object.values(db.users);
  if (c === '/help') return `/stats — статистика
/user <@имя|id|me> — профиль игрока
/top [N] — топ по балансу
/give <игрок> <money|wc|shield|double|insure|boost|betup|luckup|all|${ITEMS.join('|')}> <N>
/take <игрок> <money|wc> <N>
/set <игрок> <money|wc> <N>
/restore <игрок> <eye|hand>
/reset <игрок> — сброс прогресса
/ban <игрок> · /unban <игрок>
/giveall <money|wc> <N> — всем игрокам
/say <текст> — рассылка от бота всем
/backup — прислать копию базы в Telegram
/admins · /addadmin <id> · /deladmin <id>`;
  if (c === '/stats') return `Игроков: ${users.length}\nОнлайн за 5 мин: ${users.filter(u => Date.now() - u.seen < 3e5).length}\nЗаблокировано: ${users.filter(u => u.ban).length}\nВсего 💰: ${users.reduce((s, u) => s + (u.st?.bal || 0), 0).toLocaleString('ru-RU')}`;
  if (c === '/top') return users.sort((x, y) => (y.st?.bal || 0) - (x.st?.bal || 0)).slice(0, Math.min(20, +a[1] || 10)).map((u, i) => `${i + 1}. ${nm(u)} — ${Math.floor(u.st?.bal || 0).toLocaleString('ru-RU')} 💰`).join('\n') || 'Пусто';
  if (c === '/backup') { backup(); return 'Копия базы отправлена вам в Telegram'; }
  if (c === '/admins') return db.admins.join(', ');
  if (c === '/addadmin') { if (!/^\d+$/.test(a[1] || '')) return 'Нужен числовой ID'; if (!db.admins.includes(a[1])) db.admins.push(a[1]); save(); return 'Админ добавлен: ' + a[1]; }
  if (c === '/deladmin') { if (String(me.id) === a[1]) return 'Себя удалить нельзя'; db.admins = db.admins.filter(x => x !== a[1]); save(); return 'Админ удалён: ' + a[1]; }
  if (c === '/giveall') {
    if (!['money', 'wc'].includes(a[1]) || !(N > 0)) return 'Формат: /giveall money 1000';
    users.forEach(u => grant(u, a[1], N)); return `Выдано ${N} ${a[1]} всем (${users.length})`;
  }
  if (c === '/say') {
    const t = raw.slice(4).trim(); if (!t) return 'Нужен текст';
    users.forEach(u => tg('sendMessage', { chat_id: u.id, text: t })); return 'Рассылка отправлена: ' + users.length;
  }
  const u = need(U()); if (!u) return 'Игрок не найден (он должен хотя бы раз открыть игру)';
  if (c === '/user') return `${nm(u)} · ID ${u.id}\n💰 ${Math.floor(u.st?.bal || 0)} · 🏆 ${Math.floor(u.st?.wc || 0)}\nБан: ${u.ban ? 'да' : 'нет'} · в сети: ${new Date(u.seen).toLocaleString('ru-RU')}\nОжидает выдач: ${u.grants.length}`;
  if (c === '/ban' || c === '/unban') { u.ban = c === '/ban' ? 1 : 0; save(); return `${nm(u)}: ${u.ban ? 'заблокирован' : 'разблокирован'}`; }
  if (c === '/restore') { if (!['eye', 'hand'].includes(a[2])) return 'eye или hand'; grant(u, a[2], 1); return 'Орган восстановлен'; }
  if (c === '/reset') { grant(u, 'reset', 1); return nm(u) + ': прогресс будет сброшен'; }
  if (['/give', '/take', '/set'].includes(c)) {
    if (!(N >= 0) || (c !== '/set' && N < 1)) return 'Нужно число N';
    const k = a[2];
    if (c === '/give') {
      if (k === 'all') { ITEMS.forEach(x => grant(u, x, N)); return `${nm(u)}: выданы все предметы ×${N}`; }
      if (!BASE.includes(k) && !ITEMS.includes(k)) return 'Неизвестный предмет: ' + k;
      grant(u, k, N); return `${nm(u)}: выдано ${k} ×${N}`;
    }
    if (!['money', 'wc'].includes(k)) return 'Только money или wc';
    const cur = Math.floor(u.st?.[k === 'money' ? 'bal' : 'wc'] || 0);
    grant(u, k, c === '/take' ? -Math.min(N, cur) : N - cur); return `${nm(u)}: ${k} ${c === '/take' ? '−' + N : '= ' + N}`;
  }
  return 'Неизвестная команда. /help';
}

// ---- HTTP ----
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (e) { r({}); } }); });
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET') {
    if (url === '/health') return json(res, 200, { ok: 1 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, fs.readdirSync(__dirname).find(f => f.endsWith('.html')) || 'index.html')).pipe(res);
  }
  const me = auth(req.headers['x-init']);
  if (!me) return json(res, 401, { err: 'Откройте игру через Telegram' });
  const b = await body(req);
  if (url === '/api/sync') {
    if (b.st && typeof b.st === 'object' && !me.ban) { delete b.st.isAdm; me.st = b.st; save(); }
    const g = me.grants; me.grants = []; save();
    return json(res, 200, { st: b.st === null ? me.st : undefined, grants: g, ban: me.ban, adm: isAdmin(me.id) });
  }
  if (url === '/api/transfer') {
    if (me.ban) return json(res, 403, { err: 'Аккаунт заблокирован' });
    const amount = Math.floor(+b.amount), to = find(b.to, me), bal = Math.floor(me.st?.bal || 0);
    if (!to) return json(res, 404, { err: 'Игрок не найден — он должен хотя бы раз открыть игру' });
    if (to.id === me.id) return json(res, 400, { err: 'Нельзя переводить самому себе' });
    if (!(amount >= 1)) return json(res, 400, { err: 'Неверная сумма' });
    if (amount > bal) return json(res, 400, { err: 'Недостаточно 💰' });
    me.st.bal = bal - amount; grant(to, 'money', amount);
    tg('sendMessage', { chat_id: to.id, text: `💸 ${nm(me)} отправил вам ${amount.toLocaleString('ru-RU')} 💰` });
    return json(res, 200, { ok: 1, bal: me.st.bal, to: to.username || to.name });
  }
  if (url === '/api/admin') {
    if (!isAdmin(me.id)) return json(res, 403, { err: 'Нет доступа' });
    return json(res, 200, { out: adminCmd(me, String(b.cmd || '')) });
  }
  json(res, 404, { err: 'not found' });
});

// ---- бэкап в Telegram: база не пропадает при обновлениях на бесплатном хостинге ----
async function backup() {
  const chat = db.admins[0]; if (!BOT_TOKEN || !chat) return;
  fs.writeFileSync(DB_FILE, JSON.stringify(db)); changed = 0;
  const f = new FormData(); f.append('chat_id', chat); f.append('caption', '💾 Бэкап базы ' + new Date().toISOString());
  f.append('document', new Blob([JSON.stringify(db)]), 'data.json');
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: f }).then(x => x.json()).catch(() => ({}));
  if (r.ok) { await tg('unpinAllChatMessages', { chat_id: chat }); await tg('pinChatMessage', { chat_id: chat, message_id: r.result.message_id, disable_notification: true }); }
}
async function restore() {
  const chat = db.admins[0]; if (fs.existsSync(DB_FILE) || !BOT_TOKEN || !chat) return;
  const id = (await tg('getChat', { chat_id: chat })).result?.pinned_message?.document?.file_id; if (!id) return;
  const fp = (await tg('getFile', { file_id: id })).result?.file_path; if (!fp) return;
  try { db = JSON.parse(await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fp}`).then(x => x.text())); console.log('База восстановлена из Telegram'); } catch (e) {}
}
setInterval(() => { if (changed) backup(); }, 30 * 60 * 1000);
process.on('SIGTERM', async () => { await Promise.race([backup(), new Promise(r => setTimeout(r, 8000))]); process.exit(0); });

// ---- бот: кнопка запуска Mini App ----
const tg = (m, p) => BOT_TOKEN ? fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(r => r.json()).catch(() => ({})) : Promise.resolve({});
if (BOT_TOKEN && WEBAPP_URL) {
  tg('setChatMenuButton', { menu_button: { type: 'web_app', text: '🎰 Играть', web_app: { url: WEBAPP_URL } } });
  let off = 0;
  (async function poll() {
    for (;;) {
      const r = await tg('getUpdates', { offset: off, timeout: 30, allowed_updates: ['message'] });
      for (const u of r.result || []) {
        off = u.update_id + 1;
        const m = u.message; if (m && /^\/start/.test(m.text || ''))
          tg('sendMessage', { chat_id: m.chat.id, text: '🎰 Lucky Royale — жми «Играть»', reply_markup: { inline_keyboard: [[{ text: '🎰 Играть', web_app: { url: WEBAPP_URL } }]] } });
      }
      if (!r.ok) await new Promise(r => setTimeout(r, 3000));
    }
  })();
}

restore().then(() => { mergeAdmins(); server.listen(PORT, () => console.log('Роял Казино на порту ' + PORT + '. Игроков: ' + Object.keys(db.users).length + '. Админы: ' + (db.admins.join(',') || 'не заданы'))); });
