const btnPlayPause = document.getElementById('btn-play-pause');
const capPlay = document.getElementById('cap-play');
const capPause = document.getElementById('cap-pause');
const btnAir = document.getElementById('btn-air');
const airOn = document.getElementById('air-on');
const airOff = document.getElementById('air-off');

const ACC_URL = 'https://www.iheart.com/live/alternative-commentary-collective-6693/';

let isPlaying = false;
let streamDetected = false;

function updateAirIndicator(detected) {
  streamDetected = detected;
  airOn.classList.toggle('hidden', !detected);
  airOff.classList.toggle('hidden', detected);
}

function updatePlayPauseButton(playing) {
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

    if (result.snapshot) {
      updateAirIndicator(result.snapshot.detected);
      updatePlayPauseButton(!result.snapshot.paused);
    }
  } catch (e) {
    // silently fail
  }
}

btnPlayPause.addEventListener('click', () => {
  runAction(isPlaying ? 'pause' : 'play', {});
});

btnAir.addEventListener('click', () => {
  if (streamDetected) {
    runAction('goLive', {});
  } else {
    chrome.tabs.create({ url: ACC_URL });
  }
});

async function init() {
  await runAction('detect', {});
}

init();

// --- Content script (runs inside the active page context) ---

function runMediaAction(action, payload) {
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

  const best = detectBest();

  if (action === 'detect') {
    return { ok: true, snapshot: snapshotFromInfo(best) };
  }

  if (!best) {
    return { ok: false, error: 'No player found' };
  }

  if (action === 'play') {
    best.element.play();
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  if (action === 'pause') {
    best.element.pause();
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
    const deltaSeconds = normalizeNumber(payload && payload.deltaSeconds, 0);
    const nextDelay = clampInner(best.currentDelaySeconds + deltaSeconds, 0, best.seekWindowSeconds);
    best.element.currentTime = best.seekEnd - nextDelay;
    return { ok: true, snapshot: snapshotFromInfo(toInfo(best.element, best.index)) };
  }

  return { ok: false, error: 'Unsupported action: ' + action };
}
