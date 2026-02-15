const btnPlayPause = document.getElementById('btn-play-pause');
const capPlay = document.getElementById('cap-play');
const capPause = document.getElementById('cap-pause');
const btnAir = document.getElementById('btn-air');
const airOn = document.getElementById('air-on');
const airOff = document.getElementById('air-off');
const offsetDisplay = document.getElementById('offset-display');
const btnBack5 = document.getElementById('btn-back-5');
const btnForward5 = document.getElementById('btn-forward-5');

const ACC_URL = 'https://www.iheart.com/live/alternative-commentary-collective-6693/';

let isPlaying = false;
let streamDetected = false;
let currentDelay = 0;
let pausedAt = null;
let delayAtPause = 0;
let tickInterval = null;
let sessionId = null;
let detectedAt = null;

function renderOffset() {
  offsetDisplay.textContent = currentDelay.toFixed(1) + 's';
}

function saveState() {
  chrome.storage.local.set({
    currentDelay,
    pausedAt,
    delayAtPause,
    sessionId,
  });
}

function startTicking() {
  stopTicking();
  delayAtPause = currentDelay;
  tickInterval = setInterval(() => {
    const elapsed = (Date.now() - pausedAt) / 1000;
    currentDelay = delayAtPause + elapsed;
    offsetDisplay.textContent = currentDelay.toFixed(1) + 's';
  }, 100);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function updateLiveState(snapshot) {
  const live = snapshot && snapshot.detected && !snapshot.paused;
  streamDetected = live;
  airOn.classList.toggle('hidden', !live);
  airOff.classList.toggle('hidden', live);
}

function setPlayPauseIcon(playing) {
  isPlaying = playing;
  capPlay.classList.toggle('hidden', playing);
  capPause.classList.toggle('hidden', !playing);
}

function getActiveTabId() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const tabId = tabs && tabs[0] && tabs[0].id;
      if (!tabId) {
        reject(new Error('No active tab found.'));
        return;
      }

      resolve(tabId);
    });
  });
}

function executeMediaAction(tabId, action, payload) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: 'MAIN',
        func: runMediaAction,
        args: [action, payload],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(results && results[0] && results[0].result);
      }
    );
  });
}

async function runAction(action, payload) {
  try {
    const tabId = await getActiveTabId();
    const result = await executeMediaAction(tabId, action, payload);

    if (!result || !result.ok) return;

    if (action === 'detect' && result.sessionId) {
      sessionId = result.sessionId;
    }
    if (result.snapshot) {
      updateLiveState(result.snapshot);
      if (action === 'detect' && streamDetected) {
        if (!detectedAt) detectedAt = Date.now();
        setPlayPauseIcon(true);
      }
    }
  } catch (e) {
    console.error('[ACC Syncer]', action, e);
  }
}

btnPlayPause.addEventListener('click', () => {
  if (!streamDetected) {
    runAction('shake', {});
    return;
  }
  if (isPlaying) {
    setPlayPauseIcon(false);
    pausedAt = Date.now();
    startTicking();
    saveState();
    runAction('mute', {});
  } else {
    setPlayPauseIcon(true);
    const elapsed = pausedAt ? (Date.now() - pausedAt) / 1000 : 0;
    pausedAt = null;
    stopTicking();
    renderOffset();
    saveState();
    runAction('resume', { rewindSeconds: elapsed });
  }
});

btnAir.addEventListener('click', async (e) => {
  e.preventDefault();
  if (streamDetected) {
    if (currentDelay <= 0) return;
    if (pausedAt) {
      pausedAt = null;
      stopTicking();
      setPlayPauseIcon(true);
    }
    currentDelay = 0;
    renderOffset();
    saveState();
    runAction('goLive', {});
    return;
  }
  // Only open iHeart if not already on iheart
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://www.iheart.com')) {
      chrome.tabs.create({ url: ACC_URL });
    }
  } catch (_) {}
});

function nudge(delta) {
  if (!streamDetected) return;
  if (delta < 0 && currentDelay <= 0) return;
  var maxDelay = detectedAt ? (Date.now() - detectedAt) / 1000 : Infinity;
  if (delta > 0 && currentDelay >= maxDelay) return;
  currentDelay = Math.min(Math.max(0, currentDelay + delta), maxDelay);
  if (pausedAt) {
    delayAtPause = currentDelay;
    pausedAt = Date.now();
  }
  renderOffset();
  saveState();
  runAction('nudge', { deltaSeconds: delta });
}

btnBack5.addEventListener('click', () => nudge(5));
btnForward5.addEventListener('click', () => nudge(-5));

async function init() {
  const saved = await chrome.storage.local.get(['currentDelay', 'pausedAt', 'delayAtPause', 'sessionId']);
  await runAction('detect', {});

  const sameSession = saved.sessionId && saved.sessionId === sessionId;
  if (!sameSession) return;

  if (saved.pausedAt) {
    // Was muted when popup closed — restore muted state and keep ticking
    pausedAt = saved.pausedAt;
    delayAtPause = saved.delayAtPause || 0;
    currentDelay = delayAtPause + (Date.now() - pausedAt) / 1000;
    renderOffset();
    startTicking();
    setPlayPauseIcon(false);
  } else if (saved.currentDelay > 0) {
    currentDelay = saved.currentDelay;
    renderOffset();
  }
}

window.addEventListener('pagehide', () => {
  saveState();
});

init();

// --- Content script (runs inside the active page context) ---

function runMediaAction(action, payload) {
  try {
  function isPlaceholderSource(src) {
    return /blank\.mp4/i.test(src || '');
  }

  function toInfo(element, index) {
    const src = element.currentSrc || element.src || '';
    const hasSeekable = element.seekable && element.seekable.length > 0;
    const seekStart = hasSeekable ? element.seekable.start(0) : 0;
    const seekEnd = hasSeekable ? element.seekable.end(element.seekable.length - 1) : 0;
    const seekWindowSeconds = Math.max(0, seekEnd - seekStart);
    const currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
    const currentDelaySeconds = hasSeekable ? Math.max(0, seekEnd - currentTime) : NaN;

    return {
      element,
      index,
      src,
      paused: element.paused,
      seekStart,
      seekEnd,
      seekWindowSeconds,
      currentDelaySeconds,
      isPlaceholder: isPlaceholderSource(src),
    };
  }

  function compareInfo(a, b) {
    if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? 1 : -1;
    if (a.paused !== b.paused) return a.paused ? 1 : -1;
    if (a.seekWindowSeconds !== b.seekWindowSeconds) return b.seekWindowSeconds - a.seekWindowSeconds;
    return a.index - b.index;
  }

  function detectBest() {
    const all = Array.from(document.querySelectorAll('audio,video')).map(toInfo);
    all.sort(compareInfo);
    return all[0] || null;
  }

  function snapshotFromInfo(info) {
    if (!info) return { detected: false };

    return {
      detected: true,
      src: info.src,
      paused: info.paused,
      muted: info.element.muted,
      seekWindowSeconds: info.seekWindowSeconds,
      currentDelaySeconds: info.currentDelaySeconds,
    };
  }

  function clampInner(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (action === 'shake') {
    var buttons = document.querySelectorAll('[data-test="play-button"]');
    if (buttons.length === 0) return { ok: false, error: 'No play buttons found' };
    var styleId = 'acc-shake-style';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = '@keyframes acc-shake{0%{transform:translate(0,0)}4%{transform:translate(-6px,5px)}8%{transform:translate(7px,-6px)}12%{transform:translate(-5px,-7px)}16%{transform:translate(6px,5px)}20%{transform:translate(-7px,4px)}24%{transform:translate(5px,-6px)}28%{transform:translate(-6px,-5px)}32%{transform:translate(6px,7px)}36%{transform:translate(-5px,6px)}40%{transform:translate(7px,-5px)}44%{transform:translate(-6px,-6px)}48%{transform:translate(5px,6px)}52%{transform:translate(-7px,5px)}56%{transform:translate(6px,-5px)}60%{transform:translate(-5px,-6px)}64%{transform:translate(5px,4px)}68%{transform:translate(-4px,4px)}72%{transform:translate(4px,-3px)}76%{transform:translate(-3px,-3px)}80%{transform:translate(3px,2px)}84%{transform:translate(-2px,2px)}88%{transform:translate(2px,-1px)}92%{transform:translate(-1px,-1px)}96%{transform:translate(1px,1px)}100%{transform:translate(0,0)}}';
      document.head.appendChild(style);
    }
    buttons.forEach(function(btn) {
      btn.style.animation = 'none';
      btn.offsetHeight;
      btn.style.animation = 'acc-shake 0.9s linear';
      setTimeout(function() { btn.style.animation = ''; }, 1000);
    });
    return { ok: true };
  }

  const best = detectBest();

  if (action === 'detect') {
    return { ok: true, snapshot: snapshotFromInfo(best), sessionId: performance.timeOrigin };
  }

  if (!best) {
    return { ok: false, error: 'No player found' };
  }

  if (action === 'mute') {
    best.element.muted = true;
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  if (action === 'resume') {
    var rewindSeconds = normalizeNumber(payload && payload.rewindSeconds, 0);
    if (rewindSeconds > 0 && best.seekWindowSeconds > 0) {
      var targetTime = clampInner(
        best.element.currentTime - rewindSeconds,
        best.seekStart,
        best.seekEnd
      );
      best.element.currentTime = targetTime;
    }
    best.element.muted = false;
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  if (best.seekWindowSeconds <= 0) {
    return { ok: false, error: 'Player is not seekable right now.' };
  }

  if (action === 'goLive') {
    best.element.currentTime = best.seekEnd;
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  if (action === 'setDelay') {
    const delaySeconds = Math.max(0, normalizeNumber(payload && payload.delaySeconds, 0));
    const targetTime = clampInner(best.seekEnd - delaySeconds, best.seekStart, best.seekEnd);
    best.element.currentTime = targetTime;
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  if (action === 'nudge') {
    var LIVE_EDGE_BUFFER = 0.5;
    var deltaSeconds = normalizeNumber(payload && payload.deltaSeconds, 0);
    var nextDelay = clampInner(best.currentDelaySeconds + deltaSeconds, LIVE_EDGE_BUFFER, best.seekWindowSeconds);
    best.element.currentTime = best.seekEnd - nextDelay;
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  return { ok: false, error: 'Unsupported action: ' + action };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
