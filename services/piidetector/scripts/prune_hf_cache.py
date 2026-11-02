"""Image build stage only: delete the GLiNER torch weights from the Hugging Face cache.

The ONNX export replaces them at run time. Tokenizer and config files stay (the ONNX directory
refers to them), and so does the whole PII-Tracer snapshot. Also drops download locks and the
xet cache, which nothing reads offline.

    python scripts/prune_hf_cache.py /opt/hf
"""

import shutil
import sys
from pathlib import Path

BIG_FILE_BYTES = 50 * 2**20


def main(hf_home):
    hub = hf_home / "hub"
    for repo in hub.glob("models--*"):
        if "PII-Tracer" in repo.name:
            continue
        for blob in (repo / "blobs").glob("*"):
            if blob.is_file() and blob.stat().st_size > BIG_FILE_BYTES:
                blob.unlink()
        for link in (repo / "snapshots").rglob("*"):
            if link.is_symlink() and not link.exists():
                link.unlink()
    for path in (hub / ".locks", hf_home / "xet"):
        shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
