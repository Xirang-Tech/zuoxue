"""Build the colleague integration kit from an explicit source allowlist."""
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
files = [
    "README.md",
    "docs/ai-prd-handoff.md",
    "docs/product-integration.md",
    "config/catalog.json",
    "integrations/client.mjs",
    "integrations/client.d.mts",
    "integrations/product-adapter.mjs",
    "integrations/outbox.mjs",
    "public/widget.js",
    "public/union-media/keban.svg",
    "public/union-media/aiprd.svg",
    "public/union-media/aipm.svg",
    "public/union-media/workflow.svg",
    "public/union-media/pattern.svg",
    "public/union-media/keban-illustration.webp",
    "public/union-media/aipm-illustration.webp",
]
destination = root / "handoff" / "zuoxue-union-integration.zip"
destination.parent.mkdir(exist_ok=True)
manifest = {name: sha256((root / name).read_bytes()).hexdigest() for name in files}
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
    archive.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
with ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == {*files, "manifest.json"}
print(f"{destination.name}: {destination.stat().st_size} bytes, {len(files)} source files")
