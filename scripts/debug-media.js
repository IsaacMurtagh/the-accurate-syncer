// Paste this into the browser console on the iheart tab
(function() {
  const out = {};

  // Top-level media elements
  const topMedia = document.querySelectorAll('audio,video');
  out.topLevel = Array.from(topMedia).map((el, i) => ({
    tag: el.tagName,
    src: el.currentSrc || el.src || '(none)',
    paused: el.paused,
    currentTime: el.currentTime,
    duration: el.duration,
    seekableRanges: el.seekable.length,
    seekableEnd: el.seekable.length > 0 ? el.seekable.end(el.seekable.length - 1) : null,
    readyState: el.readyState,
    networkState: el.networkState,
  }));

  // Iframes
  const iframes = document.querySelectorAll('iframe');
  out.iframes = Array.from(iframes).map((f, i) => {
    const info = { index: i, src: f.src || '(none)', crossOrigin: false, media: [] };
    try {
      const doc = f.contentDocument || f.contentWindow.document;
      const media = doc.querySelectorAll('audio,video');
      info.media = Array.from(media).map((el) => ({
        tag: el.tagName,
        src: el.currentSrc || el.src || '(none)',
        paused: el.paused,
        currentTime: el.currentTime,
      }));
    } catch (e) {
      info.crossOrigin = true;
    }
    return info;
  });

  // Shadow DOMs (one level deep)
  const allEls = document.querySelectorAll('*');
  const shadowMedia = [];
  allEls.forEach((el) => {
    if (el.shadowRoot) {
      const media = el.shadowRoot.querySelectorAll('audio,video');
      media.forEach((m) => {
        shadowMedia.push({
          host: el.tagName,
          tag: m.tagName,
          src: m.currentSrc || m.src || '(none)',
          paused: m.paused,
        });
      });
    }
  });
  out.shadowDOM = shadowMedia;

  // Web Audio context check
  out.webAudioContextExists = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';

  console.log(JSON.stringify(out, null, 2));
})();
