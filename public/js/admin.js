// ============================================================
// แดชบอร์ดแอดมิน — admin.js
// ============================================================
const token = localStorage.getItem('sf_admin_token');
if (!token) location.href = '/admin-login.html';

const $ = id => document.getElementById(id);
let adminData = null;
let editSeats = []; // working copy ใน tab จัดการผัง
let dragSeat = null;

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2500);
}
async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(path + sep + 'token=' + encodeURIComponent(token), opts);
  return r.json();
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ['live', 'edit', 'list'].forEach(name => {
      $('tab-' + name).classList.toggle('hidden', name !== tab.dataset.tab);
    });
    if (tab.dataset.tab === 'edit') loadEditStage();
  });
});

// ---------- ดึงข้อมูลแอดมิน ----------
async function pollAdmin() {
  const data = await api('/api/admin/data');
  if (!data.ok) { localStorage.removeItem('sf_admin_token'); location.href = '/admin-login.html'; return; }
  adminData = data;
  $('stTotal').textContent = data.stats.total;
  $('stBooked').textContent = data.stats.booked;
  $('stAvail').textContent = data.stats.available;

  const phaseEl = $('stPhase'), phaseLbl = $('stPhaseLbl'), timer = $('adminTimer');
  timer.textContent = '';
  if (data.phase === 'idle') { phaseEl.textContent = 'รอเริ่ม'; phaseEl.style.color = 'var(--text-dim)'; }
  else if (data.phase === 'countdown') { phaseEl.textContent = 'นับถอยหลัง'; phaseEl.style.color = '#facc15'; timer.textContent = data.countdownRemaining + ' วิ'; }
  else if (data.phase === 'open') { phaseEl.textContent = 'เปิดจอง'; phaseEl.style.color = 'var(--green)'; timer.textContent = 'เหลือ ' + fmtTime(data.openRemaining); }
  else { phaseEl.textContent = 'ปิดแล้ว'; phaseEl.style.color = 'var(--booked)'; }

  renderLiveMap();
  renderList();
}

// ---------- ผังการจองสด (ฟีเจอร์ 4) ----------
function renderLiveMap() {
  const stage = $('liveStage');
  stage.querySelectorAll('.seat').forEach(el => el.remove());
  if (!adminData.seats.length) {
    stage.insertAdjacentHTML('beforeend', '<div class="empty" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)">ยังไม่มีที่นั่ง กรุณาไปแท็บ "จัดการผังที่นั่ง"</div>');
    return;
  }
  adminData.seats.forEach(s => {
    const el = document.createElement('div');
    el.className = 'seat ' + s.status;
    el.style.left = s.x + '%'; el.style.top = s.y + '%';
    el.innerHTML = s.label + '<span class="seat-name">' + (s.bookedBy || '') + '</span>';
    stage.appendChild(el);
  });
}

// ---------- รายชื่อผู้จอง ----------
function renderList() {
  const tb = $('bookTbody'); tb.innerHTML = '';
  $('listCount').textContent = 'มีทั้งหมด ' + adminData.bookings.length + ' คน';
  if (!adminData.bookings.length) {
    tb.innerHTML = '<tr><td colspan="4" class="empty">ยังไม่มีการจอง</td></tr>';
    return;
  }
  adminData.bookings.forEach((b, i) => {
    const d = new Date(b.bookedAt);
    const t = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    tb.insertAdjacentHTML('beforeend',
      '<tr><td>' + (i + 1) + '</td><td><b style="color:var(--accent)">' + b.label + '</b></td><td>' + b.nickname + '</td><td>' + t + '</td></tr>');
  });
}

// ---------- ปุ่มแอดมิน ----------
$('startBtn').addEventListener('click', async () => {
  if (!confirm('เริ่มการจอง? ระบบจะนับถอยหลัง 5 วินาที แล้วเปิดจอง 10 นาที หลังจากนั้นปิดอัตโนมัติ')) return;
  const r = await api('/api/admin/start', { method: 'POST' });
  if (r.ok) { toast('เริ่มระบบจองแล้ว'); pollAdmin(); }
});
$('closeBtn').addEventListener('click', async () => {
  if (!confirm('ปิดระบบทันที? จะไม่สามารถจองเพิ่มได้อีก')) return;
  const r = await api('/api/admin/close', { method: 'POST' });
  if (r.ok) { toast('ปิดระบบแล้ว'); pollAdmin(); }
});
$('resetBtn').addEventListener('click', async () => {
  if (!confirm('รีเซ็ตทั้งหมด? การจองทั้งหมดจะถูกลบและระบบกลับไปรอเริ่ม')) return;
  const r = await api('/api/admin/reset', { method: 'POST' });
  if (r.ok) { toast('รีเซ็ตแล้ว'); pollAdmin(); }
});
$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('sf_admin_token');
  location.href = '/admin-login.html';
});

// ============================================================
// Tab จัดการผังที่นั่ง
// ============================================================
function loadEditStage() {
  editSeats = adminData.seats.map(s => ({ id: s.id, label: s.label, x: s.x, y: s.y }));
  renderEditStage();
}
function renderEditStage() {
  const stage = $('editStage');
  stage.querySelectorAll('.seat').forEach(el => el.remove());
  editSeats.forEach(s => {
    const el = document.createElement('div');
    el.className = 'seat available editing';
    el.style.left = s.x + '%'; el.style.top = s.y + '%';
    el.innerHTML = s.label + '<span class="del-x" data-id="' + s.id + '">×</span>';
    el.dataset.id = s.id;
    stage.appendChild(el);
  });
}

$('addSeatBtn').addEventListener('click', () => {
  const id = 'seat_' + Date.now() + Math.random().toString(36).slice(2, 6);
  editSeats.push({ id, label: 'S' + (editSeats.length + 1), x: 20 + Math.random() * 60, y: 30 + Math.random() * 55 });
  renderEditStage();
});

$('gridBtn').addEventListener('click', () => {
  const rows = Math.max(1, Math.min(12, parseInt($('gridRows').value) || 4));
  const cols = Math.max(1, Math.min(12, parseInt($('gridCols').value) || 6));
  if (editSeats.length && !confirm('จะสร้างแบบแถวใหม่ ที่นั่งเดิมจะถูกแทนที่ (การจองที่มีอยู่จะถูกล้าง) ดำเนินการต่อ?')) return;
  editSeats = [];
  const xStart = 15, xEnd = 85, yStart = 28, yEnd = 88;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cols === 1 ? 50 : xStart + (c * (xEnd - xStart) / (cols - 1));
      const y = rows === 1 ? 55 : yStart + (r * (yEnd - yStart) / (rows - 1));
      editSeats.push({
        id: 'seat_' + Date.now() + '_' + r + '_' + c,
        label: String.fromCharCode(65 + r) + (c + 1),
        x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10
      });
    }
  }
  renderEditStage();
  toast('สร้างที่นั่ง ' + (rows * cols) + ' ที่ เรียบร้อย กดบันทึกเพื่อเก็บ');
});

$('clearSeatsBtn').addEventListener('click', () => {
  if (!confirm('ล้างที่นั่งทั้งหมด? (การจองที่มีอยู่จะถูกล้างเมื่อบันทึก)')) return;
  editSeats = []; renderEditStage();
});

$('saveSeatsBtn').addEventListener('click', async () => {
  const r = await api('/api/admin/save-seats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seats: editSeats })
  });
  if (r.ok) { toast('บันทึกผังที่นั่งแล้ว (' + r.count + ' ที่)'); pollAdmin(); }
  else toast('บันทึกไม่สำเร็จ: ' + (r.message || ''));
});

// ลบที่นั่ง (กด ×)
$('editStage').addEventListener('click', e => {
  if (e.target.classList.contains('del-x')) {
    const id = e.target.dataset.id;
    editSeats = editSeats.filter(s => s.id !== id);
    renderEditStage();
  }
});
// ดับเบิลคลิกเปลี่ยนชื่อที่นั่ง
$('editStage').addEventListener('dblclick', e => {
  const seatEl = e.target.closest('.seat.editing');
  if (!seatEl || e.target.classList.contains('del-x')) return;
  const s = editSeats.find(x => x.id === seatEl.dataset.id);
  const name = prompt('ชื่อ/รหัสที่นั่ง:', s.label);
  if (name && name.trim()) { s.label = name.trim().slice(0, 8); renderEditStage(); }
});

// ลากย้ายที่นั่ง
$('editStage').addEventListener('pointerdown', e => {
  const seatEl = e.target.closest('.seat.editing');
  if (!seatEl || e.target.classList.contains('del-x')) return;
  e.preventDefault();
  dragSeat = editSeats.find(s => s.id === seatEl.dataset.id);
  seatEl.setPointerCapture(e.pointerId);
});
$('editStage').addEventListener('pointermove', e => {
  if (!dragSeat) return;
  const rect = $('editStage').getBoundingClientRect();
  let x = ((e.clientX - rect.left) / rect.width) * 100;
  let y = ((e.clientY - rect.top) / rect.height) * 100;
  x = Math.max(6, Math.min(94, x)); y = Math.max(18, Math.min(94, y));
  dragSeat.x = Math.round(x * 10) / 10; dragSeat.y = Math.round(y * 10) / 10;
  const el = $('editStage').querySelector('.seat[data-id="' + dragSeat.id + '"]');
  if (el) { el.style.left = dragSeat.x + '%'; el.style.top = dragSeat.y + '%'; }
});
window.addEventListener('pointerup', () => { dragSeat = null; });

pollAdmin();
setInterval(pollAdmin, 2000);
