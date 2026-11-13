#!/usr/bin/env python3
"""Create a clean Microsoft Edge Add-ons package from runtime files only."""
from __future__ import annotations

import json
import posixpath
import re
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
    "src/supabase-auth.js",
    "src/supabase-config.js",
    "src/proxy-rule-sync.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "icons/status/clash32.png",
    "icons/status/clash16.png",
    "icons/status/direct32.png",
    "icons/status/direct16.png",
    "icons/status/system32.png",
    "icons/status/system16.png",
    "icons/status/unknown32.png",
    "icons/status/unknown16.png",
)


IMPORT_SPECIFIER_RE = re.compile(r'''(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']''')


def verify_archive_imports(archive: ZipFile) -> None:
    names = set(archive.namelist())
    missing_runtime_files = [name for name in RUNTIME_FILES if name not in names]
    if missing_runtime_files:
        raise SystemExit("Package is missing runtime files: " + ", ".join(missing_runtime_files))

    for source_path in RUNTIME_FILES:
        if not source_path.endswith(".js"):
            continue
        source = archive.read(source_path).decode("utf-8")
        for specifier in IMPORT_SPECIFIER_RE.findall(source):
            if not specifier.startswith("."):
                continue
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source_path), specifier))
            if resolved not in names:
                raise SystemExit(
                    f"Package is missing imported JavaScript module: {source_path} -> {resolved}"
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

    with ZipFile(output, "r") as archive:
        verify_archive_imports(archive)

    print(f"Created {output.relative_to(ROOT)}")
    print(f"Included {len(RUNTIME_FILES)} runtime files; manifest version {version}")


if __name__ == "__main__":
    main()
