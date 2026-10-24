// ============================================================
// SeatFlow V2 - ระบบจองที่นั่งห้องเรียน (วิท-คณิต)
// Full-stack Node.js + Express, เก็บข้อมูลใน data.json
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------- ค่าคงที่ระบบ ----------
const COUNTDOWN_SECONDS = 5;    // นับถอยหลังก่อนเปิดจอง 5 วินาที
const OPEN_SECONDS = 10 * 60;   // เปิดจองได้ 10 นาที (600 วินาที)
const ADMIN_CODE = 'zxcvbnm';   // รหัสแอดมิน

// ---------- จัดการเก็บข้อมูล ----------
let db = {
  seats: [],        // {id, label, x, y}
  bookings: [],     // {seatId, label, nickname, deviceId, bookedAt}
  session: { phase: 'idle', startedAt: null } // phase: idle | closed
};

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      db = Object.assign(db, JSON.parse(raw));
    }
  } catch (e) {
    console.error('loadDB error:', e.message);
  }
}
function saveDB() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('saveDB error:', e.message);
  }
}
loadDB();

// ---------- คำนวณสถานะเซสชัน (derived จากเวลา server) ----------
function getSessionState() {
  const now = Date.now();
  if (db.session.phase === 'closed') {
    return { phase: 'closed', countdownRemaining: 0, openRemaining: 0, openTotal: OPEN_SECONDS };
  }
  if (!db.session.startedAt) {
    return { phase: 'idle', countdownRemaining: COUNTDOWN_SECONDS, openRemaining: OPEN_SECONDS, openTotal: OPEN_SECONDS };
  }
  const elapsed = (now - db.session.startedAt) / 1000; // วินาที
  if (elapsed < COUNTDOWN_SECONDS) {
    return { phase: 'countdown', countdownRemaining: Math.ceil(COUNTDOWN_SECONDS - elapsed), openRemaining: OPEN_SECONDS, openTotal: OPEN_SECONDS };
  }
  if (elapsed < COUNTDOWN_SECONDS + OPEN_SECONDS) {
    return { phase: 'open', countdownRemaining: 0, openRemaining: Math.ceil(COUNTDOWN_SECONDS + OPEN_SECONDS - elapsed), openTotal: OPEN_SECONDS };
  }
  // หมดเวลา → ปิดระบบโดยสมบูรณ์ (ไม่มีเงื่อนไขใดๆ)
  if (db.session.phase !== 'closed') {
    db.session.phase = 'closed';
    saveDB();
  }
  return { phase: 'closed', countdownRemaining: 0, openRemaining: 0, openTotal: OPEN_SECONDS };
}

// ---------- Admin token (เก็บในหน่วยความจำ) ----------
const adminTokens = new Set();
function makeToken() { return crypto.randomBytes(24).toString('hex'); }
function checkToken(req) {
  const t = req.query.token || (req.body && req.body.token);
  return t && adminTokens.has(t);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// API สาธารณะ
// ============================================================

// สถานะปัจจุบัน (สำหรับหน้าจอง) — ไม่เปิดเผยชื่อผู้จอง
app.get('/api/state', (req, res) => {
  const ss = getSessionState();
  const deviceId = (req.query.deviceId || '').toString().trim();
  const myBooking = db.bookings.find(b => b.deviceId === deviceId) || null;
  const seats = db.seats.map(s => {
    const booked = db.bookings.find(b => b.seatId === s.id);
    return { id: s.id, label: s.label, x: s.x, y: s.y, status: booked ? 'booked' : 'available' };
  });
  res.json({
    phase: ss.phase,
    countdownRemaining: ss.countdownRemaining,
    openRemaining: ss.openRemaining,
    openTotal: ss.openTotal,
    seats,
    stats: { total: seats.length, booked: db.bookings.length, available: seats.length - db.bookings.length },
    alreadyBooked: !!myBooking,
    mySeat: myBooking ? { label: myBooking.label, nickname: myBooking.nickname } : null
  });
});

// จองที่นั่ง
app.post('/api/book', (req, res) => {
  const ss = getSessionState();
  // 5. ปิดระบบทันทีเมื่อเวลาหมด ไม่มีเงื่อนไขใดๆ
  if (ss.phase !== 'open') {
    return res.json({ ok: false, reason: ss.phase === 'countdown' ? 'not_open_yet' : 'closed', message: 'ระบบยังไม่เปิดหรือปิดไปแล้ว' });
  }
  let { seatId, nickname, deviceId } = req.body || {};
  seatId = (seatId || '').toString().trim();
  nickname = (nickname || '').toString().trim();
  deviceId = (deviceId || '').toString().trim();
  if (!seatId || !nickname || !deviceId) {
    return res.json({ ok: false, reason: 'invalid', message: 'ข้อมูลไม่ครบถ้วน' });
  }
  const normName = nickname.toLowerCase();

  // 2. แต่ละคนจองได้ครั้งเดียวเท่านั้น (เช็คจากชื่อเล่น และจากอุปกรณ์)
  const byName = db.bookings.find(b => b.nickname.toLowerCase() === normName);
  const byDevice = db.bookings.find(b => b.deviceId === deviceId);
  if (byName || byDevice) {
    const bk = byName || byDevice;
    return res.json({ ok: false, reason: 'already_booked', message: 'คุณจองแล้ว และคุณไม่มีโอกาสเป็นครั้งที่สองแล้ว', seat: bk.label });
  }
  // 3. โต๊ะที่จองไปแล้ว คนอื่นกดจองไม่ได้
  const seat = db.seats.find(s => s.id === seatId);
  if (!seat) return res.json({ ok: false, reason: 'invalid', message: 'ไม่มีที่นั่งนี้' });
  if (db.bookings.find(b => b.seatId === seatId)) {
    return res.json({ ok: false, reason: 'seat_taken', message: 'ที่นั่งนี้ถูกจองไปแล้ว' });
  }
  // บันทึกการจอง
  const booking = { seatId, label: seat.label, nickname, deviceId, bookedAt: Date.now() };
  db.bookings.push(booking);
  saveDB();
  res.json({ ok: true, booking });
});

// ============================================================
// API แอดมิน
// ============================================================
app.post('/api/admin/login', (req, res) => {
  const code = ((req.body && req.body.code) || '').toString();
  if (code === ADMIN_CODE) {
    const token = makeToken();
    adminTokens.add(token);
    return res.json({ ok: true, token });
  }
  res.json({ ok: false, message: 'รหัสไม่ถูกต้อง' });
});

function adminGuard(req, res) {
  if (!checkToken(req)) {
    res.json({ ok: false, reason: 'unauthorized', message: 'กรุณาเข้าสู่ระบบแอดมินใหม่' });
    return false;
  }
  return true;
}

// ข้อมูลเต็มรูปแบบสำหรับแอดมิน (มีชื่อผู้จอง)
app.get('/api/admin/data', (req, res) => {
  if (!adminGuard(req, res)) return;
  const ss = getSessionState();
  const seats = db.seats.map(s => {
    const b = db.bookings.find(bk => bk.seatId === s.id);
    return { id: s.id, label: s.label, x: s.x, y: s.y, status: b ? 'booked' : 'available', bookedBy: b ? b.nickname : null, bookedAt: b ? b.bookedAt : null };
  });
  res.json({
    ok: true,
    phase: ss.phase,
    countdownRemaining: ss.countdownRemaining,
    openRemaining: ss.openRemaining,
    openTotal: ss.openTotal,
    seats,
    bookings: db.bookings.slice().sort((a, b) => a.bookedAt - b.bookedAt),
    stats: { total: seats.length, booked: db.bookings.length, available: seats.length - db.bookings.length }
  });
});

// บันทึกผังที่นั่ง (เพิ่ม/ลด/ย้าย)
app.post('/api/admin/save-seats', (req, res) => {
  if (!adminGuard(req, res)) return;
  const seats = (req.body && req.body.seats) || [];
  // เก็บเฉพาะที่นั่งที่ยังไม่ถูกจองไว้ ถูกลบออกจะตัดการจองด้วย (ปลอดภัย)
  const keptIds = new Set(seats.map(s => s.id));
  db.bookings = db.bookings.filter(b => keptIds.has(b.seatId));
  db.seats = seats.map(s => ({ id: s.id, label: String(s.label), x: Number(s.x) || 0, y: Number(s.y) || 0 }));
  saveDB();
  res.json({ ok: true, count: db.seats.length });
});

// 1. แอดมินกดเริ่มการจอง → นับถอยหลัง 5 วิ → เปิดจอง 10 นาที → ปิดอัตโนมัติ
app.post('/api/admin/start', (req, res) => {
  if (!adminGuard(req, res)) return;
  db.session = { phase: 'idle', startedAt: Date.now() };
  saveDB();
  res.json({ ok: true, message: 'เริ่มระบบจองแล้ว' });
});

// รีเซ็ตทั้งหมด (ล้างการจอง กลับไป idle)
app.post('/api/admin/reset', (req, res) => {
  if (!adminGuard(req, res)) return;
  db.bookings = [];
  db.session = { phase: 'idle', startedAt: null };
  saveDB();
  res.json({ ok: true });
});

// ปิดระบบทันที (force close)
app.post('/api/admin/close', (req, res) => {
  if (!adminGuard(req, res)) return;
  db.session = { phase: 'closed', startedAt: db.session.startedAt };
  saveDB();
  res.json({ ok: true });
});

// route อื่นๆ → ไปหน้าจอง
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SeatFlow V2 รันที่ http://localhost:${PORT}`);
  console.log(`เปิดจอง: นับถอยหลัง ${COUNTDOWN_SECONDS} วิ + จองได้ ${OPEN_SECONDS / 60} นาที`);
});
