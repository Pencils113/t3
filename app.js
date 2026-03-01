// ============================================================
// Section 1 — Database (Dexie)
// ============================================================
const db = new Dexie('CubeTimerDB');
db.version(1).stores({
  solves: '++id, timestamp, time, penalty, dayKey'
});

// ============================================================
// Section 2 — Cube State via cubejs
// ============================================================
const FACE_COLOR = { U: '#ffffff', R: '#ef4444', F: '#22c55e', D: '#facc15', L: '#f97316', B: '#3b82f6' };

function normalizeScramble(str) {
  return str
    .replace(/[\u2019\u2032\u02BC]/g, "'") // Unicode primes → ASCII apostrophe
    .replace(/(\w)2'/g, '$12')             // U2' → U2 (half turn is its own inverse)
    .trim();
}

function applyScramble(scrambleStr) {
  const cube = new Cube();
  cube.move(normalizeScramble(scrambleStr));
  const s = cube.asString();
  return {
    U: [...s.slice(0, 9)],
    R: [...s.slice(9, 18)],
    F: [...s.slice(18, 27)],
    D: [...s.slice(27, 36)],
    L: [...s.slice(36, 45)],
    B: [...s.slice(45, 54)],
  };
}

function renderCubeNet(canvasEl, scrambleStr) {
  const ctx = canvasEl.getContext('2d');
  const cellSize = 20;
  const gap = 2;
  const faceGap = 4;
  const faceSize = cellSize * 3 + gap * 2;

  const facePositions = {
    U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2]
  };

  const totalW = 4 * faceSize + 3 * faceGap;
  const totalH = 3 * faceSize + 2 * faceGap;
  canvasEl.width = totalW;
  canvasEl.height = totalH;

  ctx.clearRect(0, 0, totalW, totalH);

  let cube;
  try {
    cube = applyScramble(scrambleStr);
  } catch {
    // Fallback: show solved state
    cube = { U: Array(9).fill('U'), R: Array(9).fill('R'), F: Array(9).fill('F'), D: Array(9).fill('D'), L: Array(9).fill('L'), B: Array(9).fill('B') };
  }

  for (const [face, [fx, fy]] of Object.entries(facePositions)) {
    const ox = fx * (faceSize + faceGap);
    const oy = fy * (faceSize + faceGap);
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = ox + col * (cellSize + gap);
      const y = oy + row * (cellSize + gap);
      ctx.fillStyle = FACE_COLOR[cube[face][i]] || '#333';
      ctx.beginPath();
      ctx.roundRect(x, y, cellSize, cellSize, 3);
      ctx.fill();
    }
  }
}

// ============================================================
// Section 3 — Scramble Generation
// ============================================================
let currentScramble = '';
let scramblePromise = null;

async function generateScramble() {
  try {
    const { randomScrambleForEvent } = await import('https://cdn.cubing.net/js/cubing/scramble');
    const scramble = await randomScrambleForEvent('333');
    return scramble.toString();
  } catch (e) {
    console.error('Scramble generation failed:', e);
    // Fallback: generate a random-move scramble
    const moves = ['R', 'L', 'U', 'D', 'F', 'B'];
    const mods = ['', "'", '2'];
    let s = [];
    let last = '';
    for (let i = 0; i < 20; i++) {
      let m;
      do { m = moves[Math.floor(Math.random() * moves.length)]; } while (m === last);
      last = m;
      s.push(m + mods[Math.floor(Math.random() * mods.length)]);
    }
    return s.join(' ');
  }
}

function prefetchScramble() {
  scramblePromise = generateScramble();
}

async function loadNextScramble() {
  const scrambleText = document.getElementById('scramble-text');
  scrambleText.textContent = 'Generating...';
  if (!scramblePromise) scramblePromise = generateScramble();
  currentScramble = await scramblePromise;
  scrambleText.textContent = currentScramble;
  renderCubeNet(document.getElementById('cube-net'), currentScramble);
  scramblePromise = generateScramble(); // prefetch next
}

// ============================================================
// Section 4 — Timer
// ============================================================
let timerState = 'idle'; // idle, arming, armed, inspecting, running
let armingTimeout = null;
let inspectionInterval = null;
let inspectionRemaining = 0;
let startTime = 0;
let elapsed = 0;
let rafId = null;
let lastSolveId = null;

const timerDisplay = document.getElementById('timer-display');
const penaltyButtons = document.getElementById('penalty-buttons');
const hintText = document.getElementById('hint-text');
const btnPlus2 = document.getElementById('btn-plus2');
const btnDnf = document.getElementById('btn-dnf');
const btnDelete = document.getElementById('btn-delete');

// PB Celebration
function celebratePB() {
  // Gold glow on timer — apply directly to avoid CSS specificity issues
  timerDisplay.style.color = '#f59e0b';
  timerDisplay.style.textShadow = '0 0 30px rgba(245, 158, 11, 0.7), 0 0 80px rgba(245, 158, 11, 0.4)';
  timerDisplay.style.transition = 'color 0.3s, text-shadow 0.3s';
  setTimeout(() => {
    timerDisplay.style.color = '';
    timerDisplay.style.textShadow = '';
    setTimeout(() => { timerDisplay.style.transition = ''; }, 500);
  }, 3500);

  // Confetti
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:300;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const colors = ['#f59e0b', '#facc15', '#fbbf24', '#6366f1', '#818cf8', '#22c55e', '#ef4444', '#ffffff'];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const particles = [];
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: W / 2 + (Math.random() - 0.5) * 100,
      y: H / 2,
      vx: (Math.random() - 0.5) * 20,
      vy: Math.random() * -18 - 2,
      w: Math.random() * 10 + 5,
      h: Math.random() * 8 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      gravity: 0.2 + Math.random() * 0.15,
    });
  }

  let frame = 0;
  function animateConfetti() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx;
      p.vy += p.gravity;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rotation += p.rotSpeed;
      const opacity = Math.max(0, 1 - frame / 140);
      if (opacity <= 0 || p.y > H + 50) continue;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 180) {
      requestAnimationFrame(animateConfetti);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(animateConfetti);
}

function formatTime(ms) {
  if (ms === Infinity || ms === null || ms === undefined) return 'DNF';
  const totalSec = ms / 1000;
  if (totalSec >= 60) {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec - min * 60;
    return `${min}:${sec.toFixed(2).padStart(5, '0')}`;
  }
  return totalSec.toFixed(2);
}

function updateTimerDisplay() {
  if (timerState !== 'running') return;
  elapsed = performance.now() - startTime;
  timerDisplay.textContent = formatTime(elapsed);
  rafId = requestAnimationFrame(updateTimerDisplay);
}

function setTimerState(state) {
  timerState = state;
  timerDisplay.classList.remove('arming', 'armed', 'running', 'inspecting');
  if (state === 'arming') timerDisplay.classList.add('arming');
  else if (state === 'armed') timerDisplay.classList.add('armed');
  else if (state === 'inspecting') timerDisplay.classList.add('inspecting');
  else if (state === 'running') timerDisplay.classList.add('running');

  // Full-screen mode: hide everything except timer when active
  document.body.classList.toggle('timer-active', state === 'arming' || state === 'armed' || state === 'inspecting' || state === 'running');
}

function getDayKey(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function saveSolve(time, scramble) {
  const now = new Date();
  const id = await db.solves.add({
    timestamp: now.getTime(),
    time: time,
    scramble: scramble,
    penalty: null,
    notes: '',
    dayKey: getDayKey(now)
  });
  invalidatePBCache();
  return id;
}

// Haptic feedback helper
function haptic(pattern) {
  if (settings.hapticEnabled && navigator.vibrate) navigator.vibrate(pattern);
}

// Shared timer actions
function timerBeginArming() {
  penaltyButtons.classList.remove('visible');
  hintText.querySelector('.hint-text-keyboard').textContent = '';
  hintText.querySelector('.hint-text-touch').textContent = '';
  haptic(10);

  if (settings.armDelay === 0) {
    // Instant arm — skip arming state
    setTimerState('armed');
    timerDisplay.textContent = '0.00';
    haptic([20, 30, 20]);
  } else {
    setTimerState('arming');
    timerDisplay.textContent = '0.00';
    armingTimeout = setTimeout(() => {
      if (timerState === 'arming') {
        setTimerState('armed');
        haptic([20, 30, 20]);
      }
    }, settings.armDelay);
  }
}

function timerCancelArming() {
  clearTimeout(armingTimeout);
  setTimerState('idle');
  hintText.querySelector('.hint-text-keyboard').textContent = 'Hold spacebar to start';
  hintText.querySelector('.hint-text-touch').textContent = 'Hold to start';
}

function timerStart() {
  if (settings.inspection > 0 && timerState !== 'inspecting') {
    // Start inspection countdown
    setTimerState('inspecting');
    inspectionRemaining = settings.inspection;
    timerDisplay.textContent = inspectionRemaining;
    prefetchScramble();
    inspectionInterval = setInterval(() => {
      inspectionRemaining--;
      if (inspectionRemaining <= 0) {
        clearInterval(inspectionInterval);
        inspectionInterval = null;
        // Auto-start the timer
        setTimerState('running');
        startTime = performance.now();
        elapsed = 0;
        updateTimerDisplay();
      } else {
        timerDisplay.textContent = inspectionRemaining;
        if (inspectionRemaining <= 3) haptic(30);
      }
    }, 1000);
    return;
  }

  // Start running (either no inspection, or after inspection)
  const wasInspecting = inspectionInterval != null;
  if (inspectionInterval) { clearInterval(inspectionInterval); inspectionInterval = null; }
  setTimerState('running');
  startTime = performance.now();
  elapsed = 0;
  hintText.querySelector('.hint-text-keyboard').textContent = '';
  hintText.querySelector('.hint-text-touch').textContent = '';
  if (!wasInspecting) prefetchScramble();
  updateTimerDisplay();
}

function timerStop() {
  cancelAnimationFrame(rafId);
  elapsed = performance.now() - startTime;
  timerDisplay.textContent = formatTime(elapsed);
  setTimerState('idle');
  penaltyButtons.classList.add('visible');
  hintText.querySelector('.hint-text-keyboard').textContent = 'Hold spacebar to start';
  hintText.querySelector('.hint-text-touch').textContent = 'Hold to start';
  btnPlus2.classList.remove('active');
  btnDnf.classList.remove('active');
  haptic(15);

  (async () => {
    const isPB = allTimePBs.single === null || elapsed < allTimePBs.single;
    lastSolveId = await saveSolve(elapsed, currentScramble);
    await refreshSidebar();
    if (isPB) celebratePB();
    await loadNextScramble();
  })();
}

// Keyboard events
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.repeat) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (timerState === 'idle') timerBeginArming();
    else if (timerState === 'inspecting') timerStart();
    else if (timerState === 'running') timerStop();
  } else if (timerState === 'running') {
    timerStop();
  } else if (timerState === 'inspecting') {
    timerStart();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (timerState === 'arming') timerCancelArming();
    else if (timerState === 'armed') timerStart();
  }
});

// Touch events on timer area
const timerMain = document.querySelector('.timer-main');

timerMain.addEventListener('touchstart', (e) => {
  if (e.target.closest('.penalty-btn') || e.target.closest('.time-item-delete')) return;
  e.preventDefault();

  if (timerState === 'idle') timerBeginArming();
  else if (timerState === 'inspecting') timerStart();
  else if (timerState === 'running') timerStop();
}, { passive: false });

timerMain.addEventListener('touchend', (e) => {
  if (e.target.closest('.penalty-btn') || e.target.closest('.time-item-delete')) return;
  e.preventDefault();

  if (timerState === 'arming') timerCancelArming();
  else if (timerState === 'armed') timerStart();
}, { passive: false });

// Penalty buttons
btnPlus2.addEventListener('click', async () => {
  if (!lastSolveId) return;
  const solve = await db.solves.get(lastSolveId);
  if (!solve) return;
  const newPenalty = solve.penalty === '+2' ? null : '+2';
  await db.solves.update(lastSolveId, { penalty: newPenalty });
  btnPlus2.classList.toggle('active', newPenalty === '+2');
  btnDnf.classList.remove('active');
  timerDisplay.textContent = formatTime(getEffectiveTime({ ...solve, penalty: newPenalty }));
  await refreshSidebar();
});

btnDnf.addEventListener('click', async () => {
  if (!lastSolveId) return;
  const solve = await db.solves.get(lastSolveId);
  if (!solve) return;
  const newPenalty = solve.penalty === 'DNF' ? null : 'DNF';
  await db.solves.update(lastSolveId, { penalty: newPenalty });
  btnDnf.classList.toggle('active', newPenalty === 'DNF');
  btnPlus2.classList.remove('active');
  timerDisplay.textContent = formatTime(getEffectiveTime({ ...solve, penalty: newPenalty }));
  await refreshSidebar();
});

btnDelete.addEventListener('click', async () => {
  if (!lastSolveId) return;
  await db.solves.delete(lastSolveId);
  invalidatePBCache();
  lastSolveId = null;
  penaltyButtons.classList.remove('visible');
  timerDisplay.textContent = '0.00';
  await refreshSidebar();
});

// ============================================================
// Section 5 — Statistics Helpers
// ============================================================
function getEffectiveTime(solve) {
  if (solve.penalty === 'DNF') return Infinity;
  if (solve.penalty === '+2') return solve.time + 2000;
  return solve.time;
}

function calcAverage(solves, n) {
  if (solves.length < n) return null;
  const window = solves.slice(0, n);
  const times = window.map(s => getEffectiveTime(s));
  const dnfCount = times.filter(t => t === Infinity).length;
  if (dnfCount > 1) return Infinity;
  // Trim best and worst
  const sorted = [...times].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1);
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

function calcMean(solves) {
  const valid = solves.filter(s => getEffectiveTime(s) !== Infinity);
  if (valid.length === 0) return null;
  return valid.reduce((a, s) => a + getEffectiveTime(s), 0) / valid.length;
}

function findBestSingle(solves) {
  let best = Infinity;
  for (const s of solves) {
    const t = getEffectiveTime(s);
    if (t < best) best = t;
  }
  return best === Infinity ? null : best;
}

function findBestAverage(solves, n) {
  if (solves.length < n) return null;
  let best = Infinity;
  for (let i = 0; i <= solves.length - n; i++) {
    const window = solves.slice(i, i + n);
    const times = window.map(s => getEffectiveTime(s));
    const dnfCount = times.filter(t => t === Infinity).length;
    if (dnfCount > 1) continue;
    const sorted = [...times].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, -1);
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    if (avg < best) best = avg;
  }
  return best === Infinity ? null : best;
}

// ============================================================
// Section 6 — UI: Sidebar
// ============================================================
let dayOffset = 0;
let allTimePBs = { single: null, ao5: null, ao12: null };
let cachedPBSet = null; // Cache PB set to avoid recalculating

async function computePBSet() {
  if (cachedPBSet) return cachedPBSet;
  const allSolvesChron = await db.solves.orderBy('timestamp').toArray();
  const pbSet = new Set();
  let runningMin = Infinity;
  for (const s of allSolvesChron) {
    const t = getEffectiveTime(s);
    if (t < runningMin) {
      runningMin = t;
      pbSet.add(s.id);
    }
  }
  cachedPBSet = pbSet;
  return pbSet;
}

function invalidatePBCache() {
  cachedPBSet = null;
}

function getDateForOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function getDayLabel(offset) {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  const d = getDateForOffset(offset);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function computeAllTimePBs() {
  const allSolves = await db.solves.orderBy('timestamp').toArray();
  allTimePBs.single = findBestSingle(allSolves);
  allTimePBs.ao5 = findBestAverage(allSolves, 5);
  allTimePBs.ao12 = findBestAverage(allSolves, 12);
}

async function refreshSidebar() {
  const dayKey = getDayKey(getDateForOffset(dayOffset));
  const daySolves = await db.solves.where('dayKey').equals(dayKey).toArray();
  daySolves.sort((a, b) => b.timestamp - a.timestamp); // newest first

  // Also get recent solves for Ao5/Ao12
  const recentSolves = await db.solves.orderBy('timestamp').reverse().toArray();

  await computeAllTimePBs();

  // Stats
  const statBest = document.getElementById('stat-best');
  const statAo5 = document.getElementById('stat-ao5');
  const statAo12 = document.getElementById('stat-ao12');
  const statMean = document.getElementById('stat-mean');

  const bestSingle = findBestSingle(daySolves);
  const ao5 = calcAverage(recentSolves, 5);
  const ao12 = calcAverage(recentSolves, 12);
  const mean = calcMean(daySolves);

  statBest.textContent = bestSingle != null ? formatTime(bestSingle) : '—';
  statAo5.textContent = ao5 != null ? formatTime(ao5) : '—';
  statAo12.textContent = ao12 != null ? formatTime(ao12) : '—';
  statMean.textContent = mean != null ? formatTime(mean) : '—';

  // PB highlighting
  statBest.classList.toggle('is-pb', bestSingle != null && allTimePBs.single != null && bestSingle <= allTimePBs.single);
  statAo5.classList.toggle('is-pb', ao5 != null && ao5 !== Infinity && allTimePBs.ao5 != null && ao5 <= allTimePBs.ao5);
  statAo12.classList.toggle('is-pb', ao12 != null && ao12 !== Infinity && allTimePBs.ao12 != null && ao12 <= allTimePBs.ao12);

  // Day nav label
  document.getElementById('day-label').textContent = getDayLabel(dayOffset);

  // Get cached PB set
  const pbSet = await computePBSet();

  // Times list
  const timesList = document.getElementById('times-list');
  timesList.innerHTML = '';
  daySolves.forEach((solve, idx) => {
    const item = document.createElement('div');
    item.className = 'time-item';
    item.addEventListener('click', () => openModal(solve.id));

    const indexEl = document.createElement('span');
    indexEl.className = 'time-item-index';
    indexEl.textContent = `${daySolves.length - idx}.`;

    const valueEl = document.createElement('span');
    valueEl.className = 'time-item-value';
    const effTime = getEffectiveTime(solve);
    if (solve.penalty === 'DNF') {
      valueEl.textContent = 'DNF';
      valueEl.classList.add('is-dnf');
    } else if (solve.penalty === '+2') {
      valueEl.textContent = formatTime(effTime) + '+';
      valueEl.classList.add('is-plus2');
    } else {
      valueEl.textContent = formatTime(effTime);
    }

    item.appendChild(indexEl);
    item.appendChild(valueEl);

    if (pbSet.has(solve.id)) {
      const pbBadge = document.createElement('span');
      pbBadge.className = 'time-item-pb';
      pbBadge.textContent = 'PB';
      item.appendChild(pbBadge);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'time-item-delete';
    deleteBtn.textContent = '\u00d7';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this solve?')) return;
      await db.solves.delete(solve.id);
      invalidatePBCache();
      if (lastSolveId === solve.id) lastSolveId = null;
      await refreshSidebar();
    });
    item.appendChild(deleteBtn);

    timesList.appendChild(item);
  });
}

document.getElementById('day-prev').addEventListener('click', () => {
  dayOffset--;
  refreshSidebar();
});

document.getElementById('day-next').addEventListener('click', () => {
  if (dayOffset < 0) {
    dayOffset++;
    refreshSidebar();
  }
});

// ============================================================
// Section 7 — UI: Modal
// ============================================================
let modalSolveId = null;
let modalOpenedFromLeaderboard = false;

async function openModal(solveId) {
  // Track if we're opening from the leaderboard/solves list page
  modalOpenedFromLeaderboard = document.getElementById('page-leaderboard').classList.contains('active');
  const solve = await db.solves.get(solveId);
  if (!solve) return;
  modalSolveId = solveId;

  const effTime = getEffectiveTime(solve);
  document.getElementById('modal-time').textContent = solve.penalty === 'DNF' ? `DNF (${formatTime(solve.time)})` : formatTime(effTime) + (solve.penalty === '+2' ? '+' : '');
  document.getElementById('modal-date').textContent = new Date(solve.timestamp).toLocaleString();
  document.getElementById('modal-scramble').textContent = solve.scramble;
  document.getElementById('modal-notes').value = solve.notes || '';

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  modalSolveId = null;
  modalOpenedFromLeaderboard = false;
}

document.getElementById('modal-save').addEventListener('click', async () => {
  if (!modalSolveId) return;
  const notes = document.getElementById('modal-notes').value;
  const wasFromLeaderboard = modalOpenedFromLeaderboard;
  await db.solves.update(modalSolveId, { notes });
  closeModal();
  await refreshSidebar();
  // Refresh solves list if it was opened from there
  if (wasFromLeaderboard) {
    await renderLeaderboard(true);
  }
});

document.getElementById('modal-delete').addEventListener('click', async () => {
  if (!modalSolveId) return;
  if (!confirm('Delete this solve?')) return;
  const id = modalSolveId;
  const wasFromLeaderboard = modalOpenedFromLeaderboard;
  closeModal();
  await db.solves.delete(id);
  invalidatePBCache();
  if (lastSolveId === id) lastSolveId = null;
  await refreshSidebar();
  // Refresh solves list if it was opened from there
  if (wasFromLeaderboard) {
    await renderLeaderboard(true);
  }
});

document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ============================================================
// Section 8 — UI: Statistics Page
// ============================================================
let chartInstances = {};

function destroyChart(name) {
  if (chartInstances[name]) {
    chartInstances[name].destroy();
    chartInstances[name] = null;
  }
}

const chartDefaults = {
  color: '#888894',
  borderColor: '#1e1e2a',
  font: { family: "'Inter', sans-serif" }
};

Chart.defaults.color = chartDefaults.color;
Chart.defaults.borderColor = chartDefaults.borderColor;
Chart.defaults.font.family = chartDefaults.font.family;

async function renderStatisticsPage() {
  const overview = document.getElementById('stats-overview');
  overview.innerHTML = '<div class="overview-card"><div class="overview-card-value">Loading...</div></div>';

  // Defer heavy computation to next frame
  await new Promise(r => setTimeout(r, 10));

  const allSolves = await db.solves.orderBy('timestamp').toArray();

  // Basic stats
  const totalSolves = allSolves.length;
  const validSolves = allSolves.filter(s => getEffectiveTime(s) !== Infinity);
  const validTimes = validSolves.map(s => getEffectiveTime(s));

  const bestSingle = findBestSingle(allSolves);
  const worstSingle = validTimes.length > 0 ? Math.max(...validTimes) : null;
  const globalMean = calcMean(allSolves);

  // Median
  let globalMedian = null;
  if (validTimes.length > 0) {
    const sorted = [...validTimes].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    globalMedian = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Std dev
  const stdDev = validTimes.length > 1 ? Math.sqrt(validTimes.reduce((sum, t) => sum + (t - globalMean) ** 2, 0) / validTimes.length) : null;

  // Averages
  const bestAo5 = findBestAverage(allSolves, 5);
  const bestAo12 = findBestAverage(allSolves, 12);
  const bestAo100 = allSolves.length >= 100 ? findBestAverage(allSolves, 100) : null;

  // Total time spent
  const totalTime = validTimes.reduce((a, b) => a + b, 0);
  const totalHours = Math.floor(totalTime / 3600000);
  const totalMins = Math.floor((totalTime % 3600000) / 60000);
  const totalTimeStr = totalHours > 0 ? `${totalHours}h ${totalMins}m` : `${totalMins}m`;

  // Sub-X counts
  const sub10 = validTimes.filter(t => t < 10000).length;
  const sub15 = validTimes.filter(t => t < 15000).length;
  const sub20 = validTimes.filter(t => t < 20000).length;

  // Solves per year
  const solvesByYear = {};
  const meanByYear = {};
  for (const s of allSolves) {
    const year = new Date(s.timestamp).getFullYear();
    if (!solvesByYear[year]) solvesByYear[year] = [];
    solvesByYear[year].push(s);
  }
  for (const year in solvesByYear) {
    meanByYear[year] = calcMean(solvesByYear[year]);
  }

  // Most solves in a day
  const solvesByDay = {};
  for (const s of allSolves) {
    solvesByDay[s.dayKey] = (solvesByDay[s.dayKey] || 0) + 1;
  }
  const maxSolvesDay = Math.max(...Object.values(solvesByDay), 0);

  // Most common time (to nearest 0.01s / 10ms)
  const timeCounts = {};
  for (const t of validTimes) {
    const rounded = Math.round(t / 10) * 10; // round to nearest 10ms
    timeCounts[rounded] = (timeCounts[rounded] || 0) + 1;
  }
  let mostCommonTime = null;
  let mostCommonCount = 0;
  for (const [time, count] of Object.entries(timeCounts)) {
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonTime = parseInt(time);
    }
  }

  // Current streak (consecutive days ending today or yesterday)
  const today = getDayKey(new Date());
  const yesterday = getDayKey(new Date(Date.now() - 86400000));
  let streak = 0;
  if (solvesByDay[today] || solvesByDay[yesterday]) {
    let checkDate = new Date(solvesByDay[today] ? today : yesterday);
    while (solvesByDay[getDayKey(checkDate)]) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }

  // Build cards
  const cards = [
    { label: 'Total Solves', value: totalSolves },
    { label: 'Best Single', value: bestSingle != null ? formatTime(bestSingle) : '—', clickable: 'single' },
    { label: 'Worst Single', value: worstSingle != null ? formatTime(worstSingle) : '—', clickable: 'worst' },
    { label: 'Best Ao5', value: bestAo5 != null ? formatTime(bestAo5) : '—', clickable: 'ao5' },
    { label: 'Best Ao12', value: bestAo12 != null ? formatTime(bestAo12) : '—', clickable: 'ao12' },
    { label: 'Best Ao100', value: bestAo100 != null ? formatTime(bestAo100) : '—' },
    { label: 'Global Mean', value: globalMean != null ? formatTime(globalMean) : '—' },
    { label: 'Global Median', value: globalMedian != null ? formatTime(globalMedian) : '—' },
    { label: 'Std Dev', value: stdDev != null ? formatTime(stdDev) : '—' },
    { label: 'Time Cubing', value: totalTimeStr },
    { label: 'Sub-10', value: sub10.toLocaleString() },
    { label: 'Sub-15', value: sub15.toLocaleString() },
    { label: 'Sub-20', value: sub20.toLocaleString() },
    { label: 'Most in a Day', value: maxSolvesDay },
    { label: 'Current Streak', value: streak > 0 ? `${streak} day${streak > 1 ? 's' : ''}` : '—' },
    { label: 'Most Common', value: mostCommonTime ? `${formatTime(mostCommonTime)} (×${mostCommonCount})` : '—' },
  ];

  // Add year stats
  const years = Object.keys(solvesByYear).sort();
  for (const year of years) {
    cards.push({ label: `Solves ${year}`, value: solvesByYear[year].length.toLocaleString() });
    cards.push({ label: `Mean ${year}`, value: meanByYear[year] != null ? formatTime(meanByYear[year]) : '—' });
  }

  overview.innerHTML = cards.map(c => `
    <div class="overview-card${c.clickable ? ' clickable' : ''}"${c.clickable ? ` data-stat="${c.clickable}"` : ''}>
      <div class="overview-card-label">${c.label}</div>
      <div class="overview-card-value">${c.value}</div>
    </div>
  `).join('');

  // Wire up clickable stat cards
  document.querySelectorAll('.overview-card.clickable').forEach(card => {
    card.addEventListener('click', () => showBestSolvesModal(card.dataset.stat, allSolves));
  });

  // Time Trend Chart
  renderTrendChart(allSolves, 50);

  // Distribution Chart
  renderDistributionChart(allSolves);

  // Daily Activity Chart
  renderDailyChart(allSolves);

  // PB Progression Chart
  renderPBChart(allSolves);

  // Time of Day Chart
  renderTODChart(allSolves);
}

let trendRange = 50;

function renderTrendChart(allSolves, range) {
  destroyChart('trend');
  let solves = range === 'all' ? allSolves : allSolves.slice(-range);

  const totalBeforeSample = solves.length;

  // Sample if too many points for performance
  const maxPoints = 500;
  if (solves.length > maxPoints) {
    const step = Math.ceil(solves.length / maxPoints);
    solves = solves.filter((_, i) => i % step === 0 || i === solves.length - 1);
  }

  // Build labels — adapt granularity to time span
  const spanDays = solves.length > 1 ? (solves[solves.length - 1].timestamp - solves[0].timestamp) / 86400000 : 0;
  const labels = solves.map(s => {
    const d = new Date(s.timestamp);
    if (spanDays < 3) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
    if (spanDays < 60) return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    return `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
  });

  // Update subtitle
  const subtitle = document.getElementById('trend-subtitle');
  if (subtitle) {
    if (solves.length < totalBeforeSample) {
      subtitle.textContent = `(${solves.length} of ${totalBeforeSample.toLocaleString()} sampled)`;
    } else {
      subtitle.textContent = '';
    }
  }

  // Individual times (null for DNF)
  const timeData = solves.map(s => {
    const t = getEffectiveTime(s);
    return t !== Infinity ? t / 1000 : null;
  });

  // Ao5 line - rolling average of last 5 solves at each point
  const ao5Data = solves.map((_, i) => {
    if (i < 4) return null;
    const window = solves.slice(i - 4, i + 1).reverse();
    const avg = calcAverage(window, 5);
    return avg != null && avg !== Infinity ? avg / 1000 : null;
  });

  // Ao12 line
  const ao12Data = solves.map((_, i) => {
    if (i < 11) return null;
    const window = solves.slice(i - 11, i + 1).reverse();
    const avg = calcAverage(window, 12);
    return avg != null && avg !== Infinity ? avg / 1000 : null;
  });

  const ctx = document.getElementById('chart-trend').getContext('2d');
  chartInstances.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Time',
          data: timeData,
          borderColor: 'rgba(99, 102, 241, 0.5)',
          backgroundColor: 'rgba(99, 102, 241, 0.8)',
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: false,
        },
        {
          label: 'Ao5',
          data: ao5Data,
          borderColor: '#22c55e',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: 'Ao12',
          data: ao12Data,
          borderColor: '#f59e0b',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            callback: function(val, idx) {
              const label = this.getLabelForValue(val);
              return label || null;
            }
          }
        },
        y: {
          ticks: {
            callback: v => v.toFixed(1) + 's'
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + 's' : 'DNF')
          }
        }
      }
    }
  });
}

let currentBinSize = 1;

function renderDistributionChart(allSolves, binSize = currentBinSize) {
  destroyChart('distribution');
  currentBinSize = binSize;
  const times = allSolves.filter(s => getEffectiveTime(s) !== Infinity).map(s => getEffectiveTime(s) / 1000);
  if (times.length === 0) return;

  const min = Math.floor(Math.min(...times) / binSize) * binSize;
  const max = Math.ceil(Math.max(...times) / binSize) * binSize;
  const buckets = {};
  for (let t of times) {
    const b = Math.floor(t / binSize) * binSize;
    buckets[b] = (buckets[b] || 0) + 1;
  }

  const labels = [];
  for (let b = min; b <= max; b += binSize) {
    labels.push(b);
  }
  const data = labels.map(l => buckets[l] || 0);

  const ctx = document.getElementById('chart-distribution').getContext('2d');
  chartInstances.distribution = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => binSize < 1 ? `${l.toFixed(2)}s` : `${l}-${l + binSize}s`),
      datasets: [{
        label: 'Solves',
        data,
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

function renderDailyChart(allSolves) {
  destroyChart('daily');
  const dayCounts = {};
  for (const s of allSolves) {
    dayCounts[s.dayKey] = (dayCounts[s.dayKey] || 0) + 1;
  }

  // Last 30 days
  const labels = [];
  const data = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = getDayKey(d);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    data.push(dayCounts[key] || 0);
  }

  const ctx = document.getElementById('chart-daily').getContext('2d');
  chartInstances.daily = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Solves',
        data,
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxRotation: 45, maxTicksLimit: 10 } },
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderPBChart(allSolves) {
  destroyChart('pb');
  const pbSolves = [];
  let runningMin = Infinity;
  for (const s of allSolves) {
    const t = getEffectiveTime(s);
    if (t < runningMin) {
      runningMin = t;
      pbSolves.push(s);
    }
  }

  if (pbSolves.length === 0) return;

  // Use {x, y} data with timestamps for proportional date spacing
  const dataPoints = pbSolves.map(s => ({ x: s.timestamp, y: getEffectiveTime(s) / 1000 }));

  const ctx = document.getElementById('chart-pb').getContext('2d');
  chartInstances.pb = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'PB',
        data: dataPoints,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.2)',
        fill: true,
        tension: 0.2,
        pointRadius: 4,
        pointBackgroundColor: '#f59e0b',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => new Date(ctx[0].parsed.x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            label: ctx => ctx.parsed.y.toFixed(2) + 's'
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: dataPoints[0].x,
          max: dataPoints[dataPoints.length - 1].x,
          ticks: {
            maxTicksLimit: 6,
            maxRotation: 0,
            callback: function(val) {
              const d = new Date(val);
              return `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
            }
          }
        },
        y: { ticks: { callback: v => v.toFixed(1) + 's' } }
      }
    }
  });
}

function renderTODChart(allSolves) {
  destroyChart('tod');
  const hourCounts = Array(24).fill(0);
  for (const s of allSolves) {
    const h = new Date(s.timestamp).getHours();
    hourCounts[h]++;
  }

  const ctx = document.getElementById('chart-tod').getContext('2d');
  chartInstances.tod = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      datasets: [{
        label: 'Solves',
        data: hourCounts,
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

// Chart filter buttons
document.querySelectorAll('.chart-filter').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.chart-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const range = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range);
    const allSolves = await db.solves.orderBy('timestamp').toArray();
    renderTrendChart(allSolves, range);
  });
});

// Bin size filter buttons
document.querySelectorAll('.bin-filter').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.bin-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const binSize = parseFloat(btn.dataset.bin);
    const allSolves = await db.solves.orderBy('timestamp').toArray();
    renderDistributionChart(allSolves, binSize);
  });
});

// Best solves modal
function findBestSolvesForAverage(solves, n) {
  if (solves.length < n) return null;
  let bestAvg = Infinity;
  let bestWindow = null;
  for (let i = 0; i <= solves.length - n; i++) {
    const window = solves.slice(i, i + n);
    const times = window.map(s => getEffectiveTime(s));
    const dnfCount = times.filter(t => t === Infinity).length;
    if (dnfCount > 1) continue;
    const sorted = [...times].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, -1);
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestWindow = window;
    }
  }
  return bestWindow;
}

function showBestSolvesModal(statType, allSolves) {
  let solves = [];
  let title = '';

  if (statType === 'single') {
    const best = allSolves.reduce((best, s) => {
      const t = getEffectiveTime(s);
      return t < getEffectiveTime(best) ? s : best;
    }, allSolves[0]);
    if (best && getEffectiveTime(best) !== Infinity) {
      solves = [best];
      title = `Best Single: ${formatTime(getEffectiveTime(best))}`;
    }
  } else if (statType === 'worst') {
    const validSolves = allSolves.filter(s => getEffectiveTime(s) !== Infinity);
    if (validSolves.length > 0) {
      const worst = validSolves.reduce((worst, s) => {
        const t = getEffectiveTime(s);
        return t > getEffectiveTime(worst) ? s : worst;
      }, validSolves[0]);
      solves = [worst];
      title = `Worst Single: ${formatTime(getEffectiveTime(worst))}`;
    }
  } else if (statType === 'ao5') {
    const window = findBestSolvesForAverage(allSolves, 5);
    if (window) {
      solves = window;
      const avg = calcAverage(window.slice().reverse(), 5);
      title = `Best Ao5: ${formatTime(avg)}`;
    }
  } else if (statType === 'ao12') {
    const window = findBestSolvesForAverage(allSolves, 12);
    if (window) {
      solves = window;
      const avg = calcAverage(window.slice().reverse(), 12);
      title = `Best Ao12: ${formatTime(avg)}`;
    }
  }

  if (solves.length === 0) return;

  // Find best and worst for highlighting (for averages)
  const times = solves.map(s => getEffectiveTime(s));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  const titleEl = document.getElementById('solves-modal-title');
  const listEl = document.getElementById('solves-modal-list');

  titleEl.textContent = title;
  listEl.innerHTML = solves.map((s, i) => {
    const effTime = getEffectiveTime(s);
    const isBest = solves.length > 1 && effTime === minTime;
    const isWorst = solves.length > 1 && effTime === maxTime;
    const isTrimmed = isBest || isWorst;

    return `
      <div class="solves-modal-item${isTrimmed ? ' trimmed' : ''}">
        <span class="solves-modal-item-index">${i + 1}.</span>
        <span class="solves-modal-item-time">${formatTime(effTime)}${s.penalty === '+2' ? '+' : ''}</span>
        <span class="solves-modal-item-date">${new Date(s.timestamp).toLocaleString()}</span>
        ${isBest ? '<span class="solves-modal-item-tag best">Best</span>' : ''}
        ${isWorst ? '<span class="solves-modal-item-tag worst">Worst</span>' : ''}
      </div>
    `;
  }).join('');

  document.getElementById('solves-modal-overlay').classList.add('open');
}

document.getElementById('solves-modal-close').addEventListener('click', () => {
  document.getElementById('solves-modal-overlay').classList.remove('open');
});

document.getElementById('solves-modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('solves-modal-overlay').classList.remove('open');
  }
});

// ============================================================
// Section 9 — UI: Solves List Page
// ============================================================
let solvesListState = {
  sortBy: 'time-asc',
  page: 1,
  pageSize: 100,
  allSolves: [],
  sortedSolves: []
};

async function renderLeaderboard(preservePage = false) {
  const tbody = document.getElementById('leaderboard-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">Loading...</td></tr>';

  await new Promise(r => setTimeout(r, 10));

  const currentPage = solvesListState.page;
  solvesListState.allSolves = await db.solves.orderBy('timestamp').toArray();
  sortSolvesListInternal(preservePage ? currentPage : 1);
  renderSolvesPage();
}

function sortSolvesListInternal(page = 1) {
  const { allSolves, sortBy } = solvesListState;
  let sorted = allSolves.map(s => ({ ...s, eff: getEffectiveTime(s) }));

  switch (sortBy) {
    case 'time-asc':
      sorted.sort((a, b) => a.eff - b.eff);
      break;
    case 'time-desc':
      sorted.sort((a, b) => b.eff - a.eff);
      break;
    case 'date-asc':
      sorted.sort((a, b) => a.timestamp - b.timestamp);
      break;
    case 'date-desc':
      sorted.sort((a, b) => b.timestamp - a.timestamp);
      break;
  }

  solvesListState.sortedSolves = sorted;

  // Ensure page is valid
  const totalPages = Math.max(1, Math.ceil(sorted.length / solvesListState.pageSize));
  solvesListState.page = Math.min(page, totalPages);
}

function sortSolvesList() {
  sortSolvesListInternal(1); // Reset to first page on sort change
}

function renderSolvesPage() {
  const { sortedSolves, page, pageSize } = solvesListState;
  const totalPages = Math.max(1, Math.ceil(sortedSolves.length / pageSize));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageSolves = sortedSolves.slice(start, end);

  // Update pagination UI
  document.getElementById('page-current').textContent = page;
  document.getElementById('page-total').textContent = totalPages;
  document.getElementById('page-prev').disabled = page <= 1;
  document.getElementById('page-next').disabled = page >= totalPages;

  const tbody = document.getElementById('leaderboard-body');
  tbody.innerHTML = '';

  pageSolves.forEach((solve, idx) => {
    const globalIdx = start + idx + 1;
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openModal(solve.id));

    const rankTd = document.createElement('td');
    rankTd.className = 'leaderboard-rank';
    rankTd.textContent = globalIdx;

    const timeTd = document.createElement('td');
    timeTd.className = 'leaderboard-time';
    if (solve.eff === Infinity) {
      timeTd.textContent = 'DNF';
      timeTd.style.color = 'var(--danger)';
    } else {
      timeTd.textContent = formatTime(solve.eff) + (solve.penalty === '+2' ? '+' : '');
    }

    const dateTd = document.createElement('td');
    dateTd.className = 'leaderboard-date';
    dateTd.textContent = new Date(solve.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

    const scrambleTd = document.createElement('td');
    scrambleTd.className = 'leaderboard-scramble';
    scrambleTd.textContent = solve.scramble || '';

    const notesTd = document.createElement('td');
    notesTd.className = 'leaderboard-notes';
    notesTd.textContent = solve.notes || '';

    tr.appendChild(rankTd);
    tr.appendChild(timeTd);
    tr.appendChild(dateTd);
    tr.appendChild(scrambleTd);
    tr.appendChild(notesTd);
    tbody.appendChild(tr);
  });
}

// Sort buttons
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    solvesListState.sortBy = btn.dataset.sort;
    sortSolvesList();
    renderSolvesPage();
  });
});

// Pagination
document.getElementById('page-prev').addEventListener('click', () => {
  if (solvesListState.page > 1) {
    solvesListState.page--;
    renderSolvesPage();
  }
});

document.getElementById('page-next').addEventListener('click', () => {
  const totalPages = Math.ceil(solvesListState.sortedSolves.length / solvesListState.pageSize);
  if (solvesListState.page < totalPages) {
    solvesListState.page++;
    renderSolvesPage();
  }
});

document.getElementById('page-size').addEventListener('change', (e) => {
  const val = parseInt(e.target.value);
  if (val >= 10 && val <= 1000) {
    solvesListState.pageSize = val;
    solvesListState.page = 1;
    renderSolvesPage();
  }
});

// ============================================================
// Section 10 — Settings
// ============================================================
const defaultSettings = {
  armDelay: 300,
  inspection: 0,
  showCubeNet: true,
  hapticEnabled: true,
};

let settings = { ...defaultSettings };

function loadSettings() {
  try {
    const saved = localStorage.getItem('t3-settings');
    if (saved) Object.assign(settings, JSON.parse(saved));
  } catch {}
  applySettings();
}

function saveSettings() {
  localStorage.setItem('t3-settings', JSON.stringify(settings));
  applySettings();
}

function applySettings() {
  // Cube net visibility
  const cubeNet = document.getElementById('cube-net');
  if (cubeNet) cubeNet.style.display = settings.showCubeNet ? '' : 'none';

  // Sync UI controls
  document.getElementById('setting-arm-delay').value = settings.armDelay;
  document.getElementById('setting-arm-delay-value').textContent = settings.armDelay + 'ms';
  document.getElementById('setting-inspection').value = settings.inspection;
  document.getElementById('setting-cube-net').checked = settings.showCubeNet;
  document.getElementById('setting-haptic').checked = settings.hapticEnabled;
}

// Arming delay slider
document.getElementById('setting-arm-delay').addEventListener('input', (e) => {
  settings.armDelay = parseInt(e.target.value);
  document.getElementById('setting-arm-delay-value').textContent = settings.armDelay + 'ms';
  saveSettings();
});

// Inspection time
document.getElementById('setting-inspection').addEventListener('change', (e) => {
  settings.inspection = parseInt(e.target.value);
  saveSettings();
});

// Show cube net
document.getElementById('setting-cube-net').addEventListener('change', (e) => {
  settings.showCubeNet = e.target.checked;
  saveSettings();
});

// Haptic feedback
document.getElementById('setting-haptic').addEventListener('change', (e) => {
  settings.hapticEnabled = e.target.checked;
  saveSettings();
});

// Delete all times
document.getElementById('setting-delete-all').addEventListener('click', async () => {
  const count = await db.solves.count();
  if (count === 0) { alert('No solves to delete.'); return; }
  if (!confirm(`Delete all ${count.toLocaleString()} solves? This cannot be undone.`)) return;
  if (!confirm('Are you sure? This will permanently erase all your data.')) return;
  await db.solves.clear();
  invalidatePBCache();
  allTimePBs = { single: null, ao5: null, ao12: null };
  lastSolveId = null;
  await refreshSidebar();
  alert('All solves deleted.');
});

// ============================================================
// Section 11 — Initialization
// ============================================================

// Export CSV
document.getElementById('export-btn').addEventListener('click', async () => {
  const allSolves = await db.solves.orderBy('timestamp').toArray();

  // CSV header
  const headers = ['Index', 'Time (s)', 'Penalty', 'Scramble', 'Date', 'Notes'];
  const rows = [headers.join(',')];

  // CSV rows
  allSolves.forEach((solve, i) => {
    const timeInSec = (solve.time / 1000).toFixed(3);
    const penalty = solve.penalty || '';
    const scramble = `"${solve.scramble.replace(/"/g, '""')}"`;
    const date = `"${new Date(solve.timestamp).toLocaleString()}"`;
    const notes = `"${(solve.notes || '').replace(/"/g, '""')}"`;
    rows.push([i + 1, timeInSec, penalty, scramble, date, notes].join(','));
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `cube_timer_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Import CSV
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');

  // Skip header
  const dataLines = lines.slice(1);

  // Get existing solves for deduplication (by timestamp + time + scramble)
  const existing = await db.solves.toArray();
  const existingKeys = new Set(existing.map(s => `${s.timestamp}-${s.time}-${s.scramble}`));

  const newSolves = [];
  let skipped = 0;

  for (const line of dataLines) {
    // Parse CSV with quoted fields
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);

    if (fields.length < 5) continue;

    // Parse fields: Index, Time (s), Penalty, Scramble, Date, Notes
    const timeInSec = parseFloat(fields[1]);
    const penalty = fields[2] || null;
    const scramble = fields[3];
    const dateStr = fields[4];
    const notes = fields[5] || '';

    if (isNaN(timeInSec)) continue;

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;

    const time = timeInSec * 1000;
    const timestamp = date.getTime();
    const key = `${timestamp}-${time}-${scramble}`;

    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    existingKeys.add(key);
    newSolves.push({
      timestamp,
      time,
      scramble,
      penalty: penalty === '+2' || penalty === 'DNF' ? penalty : null,
      notes,
      dayKey: getDayKey(date)
    });
  }

  if (newSolves.length > 0) {
    // Bulk add in chunks
    const chunkSize = 5000;
    for (let i = 0; i < newSolves.length; i += chunkSize) {
      await db.solves.bulkAdd(newSolves.slice(i, i + chunkSize));
    }
    invalidatePBCache();
    await computeAllTimePBs();
    await refreshSidebar();
  }

  alert(`Imported ${newSolves.length} solves, skipped ${skipped} duplicates.`);

  // Reset file input
  e.target.value = '';
});

// Nav logo - go to timer
document.querySelector('.nav-logo').addEventListener('click', () => {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-timer').classList.add('active');
});

// Nav tabs
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pageId = `page-${tab.dataset.page}`;
    document.getElementById(pageId).classList.add('active');

    if (tab.dataset.page === 'statistics') renderStatisticsPage();
    if (tab.dataset.page === 'leaderboard') renderLeaderboard();
  });
});

// Settings modal
const settingsOverlay = document.getElementById('settings-modal-overlay');
document.getElementById('settings-btn').addEventListener('click', () => {
  settingsOverlay.classList.add('open');
});
document.getElementById('settings-modal-close').addEventListener('click', () => {
  settingsOverlay.classList.remove('open');
});
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});

// Initialize
(async () => {
  // Import from CSV if database is empty
  const count = await db.solves.count();
  if (count === 0) {
    try {
      const response = await fetch('old_cube_desk_times.csv');
      if (response.ok) {
        const text = await response.text();
        const lines = text.replace(/\r\n/g, '\n').trim().split('\n').slice(1); // handle Windows line endings, skip header
        const solves = [];
        for (const line of lines) {
          // Parse CSV: Index,Time,Scramble,Date (date has internal comma)
          // Split by comma, but date is last two parts joined
          const parts = line.split(',');
          if (parts.length < 4) continue;
          const timeStr = parts[1];
          const scramble = parts[2];
          const dateStr = parts.slice(3).join(','); // rejoin date parts
          const time = parseFloat(timeStr) * 1000; // convert to ms
          if (isNaN(time)) continue;
          const date = new Date(dateStr.trim());
          if (isNaN(date.getTime())) continue;
          solves.push({
            timestamp: date.getTime(),
            time: time,
            scramble: scramble.trim(),
            penalty: null,
            notes: '',
            dayKey: getDayKey(date)
          });
        }
        // Bulk add in chunks for performance
        const chunkSize = 5000;
        for (let i = 0; i < solves.length; i += chunkSize) {
          await db.solves.bulkAdd(solves.slice(i, i + chunkSize));
        }
        console.log(`Imported ${solves.length} solves from CSV`);
      }
    } catch (e) {
      console.log('No CSV file found, starting fresh:', e);
    }
  }

  loadSettings();
  await computeAllTimePBs();
  await refreshSidebar();
  await loadNextScramble();
})();
