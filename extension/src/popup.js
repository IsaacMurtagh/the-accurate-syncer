const DEFAULT_DELAY_SECONDS = 12;
const NUDGE_SMALL = 1.0;
const NUDGE_BIG = 5.0;

const lagReadout = document.getElementById('lag-readout');
const onAirLight = document.getElementById('on-air');

const buttons = {
  play: document.getElementById('btn-play'),
  pause: document.getElementById('btn-pause'),
  delay1: document.getElementById('btn-delay-1'),
  delay5: document.getElementById('btn-delay-5'),
  catchup1: document.getElementById('btn-catchup-1'),
  catchup5: document.getElementById('btn-catchup-5'),
  scram: document.getElementById('btn-scram'),
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatLag(seconds) {
  if (!Number.isFinite(seconds)) return '--.-s';
  const sign = seconds >= 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const whole = Math.floor(abs).toString().padStart(2, '0');
  const frac = (abs % 1).toFixed(1).slice(1); // ".X"
  return sign + whole + frac + 's';
}

function updateLagDisplay(delaySeconds) {
  lagReadout.textContent = formatLag(delaySeconds);
}

function setOnAir(playing) {
  if (playing) {
    onAirLight.classList.remove('dimmed');
  } else {
    onAirLight.classList.add('dimmed');
  }
}

function setStatus(text, isError) {
  // Status is now conveyed via ON AIR light and LCD readout.
  // On error, show message in the readout briefly.
  if (isError) {
    lagReadout.textContent = 'ERR';
    setOnAir(false);
  }
}

function setBusy(isBusy) {
  Object.values(buttons).forEach((button) => {
    button.disabled = isBusy;
  });
}

function updateSnapshot(snapshot) {
  if (!snapshot || !snapshot.detected) {
    updateLagDisplay(NaN);
    setOnAir(false);
    return;
  }

  updateLagDisplay(snapshot.currentDelaySeconds);
  setOnAir(!snapshot.paused);
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

async function runAction(action, payload, options) {
  const useBusy = !options || options.busy !== false;

  if (useBusy) setBusy(true);

  try {
    const tabId = await getActiveTabId();
    const result = await executeMediaAction(tabId, action, payload);

    if (!result || !result.ok) {
      throw new Error((result && result.error) || 'Nah, that didn\'t work');
    }

    updateSnapshot(result.snapshot);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    if (useBusy) setBusy(false);
  }
}

// --- Button press animation ---
function addPressEffect(btn) {
  btn.addEventListener('mousedown', () => btn.classList.add('pressing'));
  btn.addEventListener('mouseup', () => btn.classList.remove('pressing'));
  btn.addEventListener('mouseleave', () => btn.classList.remove('pressing'));
}

Object.values(buttons).forEach(addPressEffect);

// --- Event listeners ---

buttons.play.addEventListener('click', () => {
  runAction('play', {});
});

buttons.pause.addEventListener('click', () => {
  runAction('pause', {});
});

buttons.delay1.addEventListener('click', () => {
  runAction('nudge', { deltaSeconds: NUDGE_SMALL });
});

buttons.delay5.addEventListener('click', () => {
  runAction('nudge', { deltaSeconds: NUDGE_BIG });
});

buttons.catchup1.addEventListener('click', () => {
  runAction('nudge', { deltaSeconds: -NUDGE_SMALL });
});

buttons.catchup5.addEventListener('click', () => {
  runAction('nudge', { deltaSeconds: -NUDGE_BIG });
});

buttons.scram.addEventListener('click', () => {
  runAction('goLive', {});
});

// --- Init ---

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
    return { ok: false, error: 'No player found — open a live stream first, legend' };
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
