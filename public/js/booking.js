// ============================================================
// หน้าจองที่นั่ง — booking.js
// ============================================================
let deviceId = localStorage.getItem('sf_device_id');
if (!deviceId) {
  deviceId = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('sf_device_id', deviceId);
}

let selectedSeatId = null;
let state = null;
let alreadyShown = false;

const $ = id => document.getElementById(id);

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2500);
}
function closeModal(id) { $(id).classList.remove('show'); }
function showModal(id) { $(id).classList.add('show'); }

// ---------- แสดงผลสถานะระบบ ----------
function renderStatus() {
  const banner = $('statusBanner'), text = $('statusText'), big = $('bigTimer'), fill = $('timerFill');
  banner.className = 'status-banner ' + state.phase;
  big.classList.add('hidden'); fill.style.width = '0%';

  if (state.phase === 'idle') {
    text.innerHTML = '⏳ ระบบยังไม่เปิดให้จอง — กรุณารอแอดมินกด <b>เริ่มการจอง</b>';
  } else if (state.phase === 'countdown') {
    text.innerHTML = '🚀 เตรียมตัว! เปิดจองในอีก...';
    big.classList.remove('hidden');
    big.textContent = state.countdownRemaining;
    big.style.color = '#facc15';
  } else if (state.phase === 'open') {
    text.innerHTML = '🟢 ระบบเปิดให้จองแล้ว — เหลือเวลาจอง';
    big.classList.remove('hidden');
    big.textContent = fmtTime(state.openRemaining);
    big.style.color = '#4ade80';
    const pct = (state.openRemaining / state.openTotal) * 100;
    fill.style.width = pct + '%';
  } else {
    text.innerHTML = '🔒 ระบบปิดแล้ว — เวลาจองหมด (ไม่มีเงื่อนไขใดๆ)';
  }
}

// ---------- วาดผังที่นั่ง ----------
function renderSeats() {
  const stage = $('seatStage');
  // ลบที่นั่งเก่า (เหลือแค่กระดาน)
  stage.querySelectorAll('.seat').forEach(el => el.remove());
  state.seats.forEach(s => {
    const el = document.createElement('div');
    el.className = 'seat ' + s.status;
    if (s.id === selectedSeatId && s.status === 'available') el.classList.add('selected');
    el.style.left = s.x + '%';
    el.style.top = s.y + '%';
    el.innerHTML = s.label + '<span class="seat-name">' + (s.bookedBy || '') + '</span>';
    el.dataset.id = s.id;
    el.addEventListener('click', () => onSeatClick(s));
    stage.appendChild(el);
  });
}

function onSeatClick(s) {
  // 3. โต๊ะที่จองไปแล้ว กดจองไม่ได้
  if (s.status === 'booked') { showModal('modalTaken'); return; }
  if (state.phase !== 'open') {
    if (state.phase === 'closed') showModal('modalClosed');
    else toast('ระบบยังไม่เปิดให้จอง กรุณารอ');
    return;
  }
  if (state.alreadyBooked) { showModal('modalAlready'); return; }
  selectedSeatId = (selectedSeatId === s.id) ? null : s.id;
  updateBookBox();
  renderSeats();
}

function updateBookBox() {
  const disp = $('selectedSeatDisplay'), btn = $('confirmBtn');
  const seat = state.seats.find(s => s.id === selectedSeatId);
  if (seat) {
    disp.innerHTML = 'ที่นั่ง: <span class="seat-tag">' + seat.label + '</span>';
    btn.disabled = false;
  } else {
    disp.textContent = 'ยังไม่ได้เลือกที่นั่ง';
    btn.disabled = true;
  }
}

// ---------- ยืนยันการจอง ----------
$('confirmBtn').addEventListener('click', async () => {
  const nickname = $('nicknameInput').value.trim();
  if (!selectedSeatId) { toast('กรุณาเลือกที่นั่งก่อน'); return; }
  if (!nickname) { toast('กรุณาใส่ชื่อเล่น'); $('nicknameInput').focus(); return; }
  const btn = $('confirmBtn');
  btn.disabled = true; btn.textContent = 'กำลังจอง...';
  try {
    const r = await fetch('/api/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seatId: selectedSeatId, nickname, deviceId })
    });
    const data = await r.json();
    if (data.ok) {
      $('successSeat').textContent = data.booking.label;
      $('successName').textContent = data.booking.nickname;
      showModal('modalSuccess');
      selectedSeatId = null; $('nicknameInput').value = '';
      await pollState();
    } else {
      if (data.reason === 'already_booked') {
        // 2. popup เด้ง: คุณจองแล้ว ไม่มีโอกาสครั้งที่สอง
        $('alreadySeat').textContent = data.seat || '-';
        showModal('modalAlready');
      } else if (data.reason === 'seat_taken') {
        showModal('modalTaken'); selectedSeatId = null;
      } else {
        showModal('modalClosed');
      }
      await pollState();
    }
  } catch (e) {
    toast('เชื่อมต่อผิดพลาด ลองใหม่');
  } finally {
    btn.disabled = false; btn.textContent = 'ยืนยันการจอง';
  }
});

// ---------- ดึงสถานะจาก server ทุก 1 วินาที ----------
async function pollState() {
  try {
    const r = await fetch('/api/state?deviceId=' + encodeURIComponent(deviceId));
    state = await r.json();
    renderStatus();
    renderSeats();
    updateBookBox();
    $('statAvail').textContent = state.stats.available;
    $('statBooked').textContent = state.stats.booked;

    // 2. ถ้าคนนี้จองแล้ว → แสดงกล่อง + popup เด้งมาทันที (ครั้งแรก)
    if (state.alreadyBooked && state.mySeat) {
      $('myBookingBox').classList.remove('hidden');
      $('bookBox').classList.add('hidden');
      $('mySeatLabel').textContent = 'ที่นั่ง ' + state.mySeat.label;
      if (!alreadyShown) {
        alreadyShown = true;
        $('alreadySeat').textContent = state.mySeat.label;
        setTimeout(() => showModal('modalAlready'), 600);
      }
    } else {
      $('myBookingBox').classList.add('hidden');
      $('bookBox').classList.remove('hidden');
    }
    // ถ้าที่เลือกถูกคนอื่นจองไป → เคลียร์
    if (selectedSeatId) {
      const s = state.seats.find(x => x.id === selectedSeatId);
      if (!s || s.status !== 'available') { selectedSeatId = null; updateBookBox(); }
    }
  } catch (e) { /* ข้าม */ }
}

pollState();
setInterval(pollState, 1000);
