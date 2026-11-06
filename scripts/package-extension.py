#!/usr/bin/env python3
"""Create a clean Microsoft Edge Add-ons package from runtime files only."""
from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
RUNTIME_FILES = (
    "manifest.json",
    "background.js",
    "settings.html",
    "settings.css",
    "settings.js",
    "src/popup.html",
    "src/popup.css",
    "src/popup.js",
    "src/core.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "icons/status/clash32.png",
    "icons/status/direct32.png",
    "icons/status/system32.png",
    "icons/status/unknown32.png",
)


def main() -> None:
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = manifest.get("version")
    if not isinstance(version, str) or not version.strip():
        raise SystemExit("manifest.json must define a non-empty version")

    missing = [name for name in RUNTIME_FILES if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Missing runtime files: " + ", ".join(missing))

    DIST.mkdir(exist_ok=True)
    output = DIST / f"Alaxee-Proxy-v{version}.zip"
    if output.exists():
        output.unlink()

    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name in RUNTIME_FILES:
            archive.write(ROOT / name, arcname=name)

    print(f"Created {output.relative_to(ROOT)}")
    print(f"Included {len(RUNTIME_FILES)} runtime files; manifest version {version}")


if __name__ == "__main__":
    main()
