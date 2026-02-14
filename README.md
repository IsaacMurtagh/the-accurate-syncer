# The ACCurate Syncer

A browser extension for syncing live ACC commentary with your sports stream.

## Current V1

- Detects the best on-page `audio`/`video` element
- Delay slider for moving backward/forward from live
- Editable delay input (seconds)
- Quick nudges: `+0.5s back` / `-0.5s forward`
- `Live` jump action
- Stores your preferred delay locally in extension storage

## Notes

- Works best on players with a seekable live window (DVR-style live streams).
- Tokenized stream URLs are not required for V1 because control happens on the page media element.

## Run locally

1. Install dependencies with `npm install`
2. Open `chrome://extensions/` and enable Developer mode
3. Click Load unpacked and select `extension/`
4. Open a live stream page, start playback, then use the extension popup controls

## License

MIT - see [LICENSE](LICENSE).
