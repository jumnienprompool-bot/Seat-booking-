const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

const COUNTDOWN_SECONDS = 5;
const OPEN_SECONDS = 10 * 60;
const ADMIN_CODE = 'zxcvbnm';

let db = {
  seats: [],
  bookings: [],
  session: { phase: 'idle', startedAt: null }
};

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      db = Object.assign(db, JSON.parse(raw));
    }
  } catch (e) { console.error('loadDB error:', e.message); }
}
function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('saveDB error:', e.message); }
}
loadDB();

function getSessionState() {
  const now = Date.now();
  if (db.session.phase === 'closed') {
    return { phase: 'closed', countdownRemaining: 0, openRemaining: 0, openTotal: OPEN_SECONDS };
  }
  if (!db.session.startedAt) {
    return { phase: 'idle', countdownRemaining: COUNTDOWN_SECONDS, openRemaining: OPEN_SECONDS, openTotal: OPEN_SECONDS };
  }
  const elapsed = (now - db.session.startedAt) / 1000;
  if (elapsed < COUNTDOWN_SECONDS) {
    return { phase: 'countdown', countdownRemaining: Math.ceil(COUNTDOWN_SECONDS - elapsed), openRemaining: OPEN_SECONDS, openTotal: OPEN_SECONDS };
  }
  if (elapsed < COUNTDOWN_SECONDS + OPEN_SECONDS) {
    return { phase: 'open', countdownRemaining: 0, openRemaining: Math.ceil(COUNTDOWN_SECONDS + OPEN_SECONDS - elapsed), openTotal: OPEN_SECONDS };
  }
  if (db.session.phase !== 'closed') { db.session.phase = 'closed'; saveDB(); }
  return { phase: 'closed', countdownRemaining: 0, openRemaining: 0, openTotal: OPEN_SECONDS };
}

const adminTokens = new Set();
function makeToken() { return crypto.randomBytes(24).toString('hex'); }
function checkToken(req) {
  const t = req.query.token || (req.body && req.body.token);
  return t && adminTokens.has(t);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  const ss = getSessionState();
  const deviceId = (req.query.deviceId || '').toString().trim();
  const myBooking = db.bookings.find(b => b.deviceId === deviceId) || null;
  const seats = db.seats.map(s => {
    const booked = db.bookings.find(b => b.seatId === s.id);
    return { id: s.id, label: s.label, x: s.x, y: s.y, status: booked ? 'booked' : 'available' };
  });
  res.json({
    phase: ss.phase, countdownRemaining: ss.countdownRemaining,
    openRemaining: ss.openRemaining, openTotal: ss.openTotal, seats,
    stats: { total: seats.length, booked: db.bookings.length, available: seats.length - db.bookings.length },
    alreadyBooked: !!myBooking,
    mySeat: myBooking ? { label: myBooking.label, nickname: myBooking.nickname } : null
  });
});

app.post('/api/book', (req, res) => {
  const ss = getSessionState();
  if (ss.phase !== 'open') {
    return res.json({ ok: false, reason: ss.phase === 'countdown' ? 'not_open_yet' : 'closed', message: 'ระบบยังไม่เปิดหรือปิดไปแล้ว' });
  }
  let { seatId, nickname, deviceId } = req.body || {};
  seatId = (seatId || '').toString().trim();
  nickname = (nickname || '').toString().trim();
  deviceId = (deviceId || '').toString().trim();
  if (!seatId || !nickname || !deviceId) return res.json({ ok: false, reason: 'invalid', message: 'ข้อมูลไม่ครบถ้วน' });
  const normName = nickname.toLowerCase();
  const byName = db.bookings.find(b => b.nickname.toLowerCase() === normName && !b.deviceId.startsWith('admin_'));
  const byDevice = db.bookings.find(b => b.deviceId === deviceId);
  if (byName || byDevice) {
    const bk = byName || byDevice;
    return res.json({ ok: false, reason: 'already_booked', message: 'คุณจองแล้ว และคุณไม่มีโอกาสเป็นครั้งที่สองแล้ว', seat: bk.label });
  }
  const seat = db.seats.find(s => s.id === seatId);
  if (!seat) return res.json({ ok: false, reason: 'invalid', message: 'ไม่มีที่นั่งนี้' });
  if (db.bookings.find(b => b.seatId === seatId)) return res.json({ ok: false, reason: 'seat_taken', message: 'ที่นั่งนี้ถูกจองไปแล้ว' });
  const booking = { seatId, label: seat.label, nickname, deviceId, bookedAt: Date.now() };
  db.bookings.push(booking); saveDB();
  res.json({ ok: true, booking });
});

app.post('/api/admin/login', (req, res) => {
  const code = ((req.body && req.body.code) || '').toString();
  if (code === ADMIN_CODE) {
    const token = makeToken(); adminTokens.add(token);
    return res.json({ ok: true, token });
  }
  res.json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
});

function adminGuard(req, res) {
  if (!checkToken(req)) { res.json({ ok: false, reason: 'unauthorized', message: 'กรุณาเข้าสู่ระบบแอดมินใหม่' }); return false; }
  return true;
}

app.get('/api/admin/data', (req, res) => {
  if (!adminGuard(req, res)) return;
  const ss = getSessionState();
  const seats = db.seats.map(s => {
    const b = db.bookings.find(bk => bk.seatId === s.id);
    return { id: s.id, label: s.label, x: s.x, y: s.y, status: b ? 'booked' : 'available', bookedBy: b ? b.nickname : null, bookedAt: b ? b.bookedAt : null, byAdmin: b ? b.deviceId.startsWith('admin_') : false };
  });
  res.json({
    ok: true, phase: ss.phase, countdownRemaining: ss.countdownRemaining,
    openRemaining: ss.openRemaining, openTotal: ss.openTotal, seats,
    bookings: db.bookings.slice().sort((a, b) => a.bookedAt - b.bookedAt),
    stats: { total: seats.length, booked: db.bookings.length, available: seats.length - db.bookings.length }
  });
});

app.post('/api/admin/save-seats', (req, res) => {
  if (!adminGuard(req, res)) return;
  const seats = (req.body && req.body.seats) || [];
  const keptIds = new Set(seats.map(s => s.id));
  db.bookings = db.bookings.filter(b => keptIds.has(b.seatId));
  db.seats = seats.map(s => ({ id: s.id, label: String(s.label), x: Number(s.x) || 0, y: Number(s.y) || 0 }));
  saveDB();
  res.json({ ok: true, count: db.seats.length });
});

app.post('/api/admin/start', (req, res) => {
  if (!adminGuard(req, res)) return;
  db.session = { phase: 'idle', startedAt: Date.now() };
  saveDB();
  res.json({ ok: true, message: 'เริ่มระบบจองแล้ว' });
});

app.post('/api/admin/reset', (req, res) => {
  if (!adminGuard(req, res)) return;
  db.bookings = [];
  db.session = { phase: 'idle', startedAt: null };
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/close', (req, res) => {
  if (!adminGuard(req, res)) return;
  db.session = { phase: 'closed', startedAt: db.session.startedAt };
  saveDB();
  res.json({ ok: true });
});

// ==== ฟีเจอร์ใหม่: แอดมินจองที่นั่งไว้ล่วงหน้า (ไม่ต้องเปิดระบบ) ====
app.post('/api/admin/reserve', (req, res) => {
  if (!adminGuard(req, res)) return;
  let { seatId, nickname } = req.body || {};
  seatId = (seatId || '').toString().trim();
  nickname = (nickname || '').toString().trim() || 'แอดมินจองไว้';
  const seat = db.seats.find(s => s.id === seatId);
  if (!seat) return res.json({ ok: false, message: 'ไม่มีที่นั่งนี้' });
  if (db.bookings.find(b => b.seatId === seatId)) return res.json({ ok: false, message: 'ที่นั่งนี้ถูกจองไปแล้ว' });
  db.bookings.push({ seatId, label: seat.label, nickname, deviceId: 'admin_' + Date.now(), bookedAt: Date.now(), byAdmin: true });
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/unreserve', (req, res) => {
  if (!adminGuard(req, res)) return;
  const seatId = ((req.body && req.body.seatId) || '').toString().trim();
  const before = db.bookings.length;
  db.bookings = db.bookings.filter(b => b.seatId !== seatId);
  if (db.bookings.length === before) return res.json({ ok: false, message: 'ที่นั่งนี้ยังไม่มีการจอง' });
  saveDB();
  res.json({ ok: true });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
  console.log(`SeatFlow V2 รันที่ http://localhost:${PORT}`);
  console.log(`เปิดจอง: นับถอยหลัง ${COUNTDOWN_SECONDS} วิ + จองได้ ${OPEN_SECONDS / 60} นาที`);
});
