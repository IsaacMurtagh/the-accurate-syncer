#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: build-zip.sh <version>}"
cd extension && zip -r "../the-accurate-syncer-${VERSION}.zip" . -x '.*'
