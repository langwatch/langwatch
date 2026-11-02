"""Image build stage only: bake the models into the image.

    python scripts/build_assets.py /opt/onnx/gliner

1. Downloads the pinned GLiNER and PII-Tracer revisions into HF_HOME.
2. Exports GLiNER to fp32 ONNX with gliner's own exporter (opset 19, falling back to 17 and 14;
   no quantisation).
3. Loads Tracer once, so the code it ships (trust_remote_code) is in the cache for offline use.
4. Loads the ONNX export back with downloads disabled, to prove the directory is self-contained.

The Dockerfile then deletes the GLiNER torch weights, which the ONNX export replaces.
Prints no text and no spans.
"""

import json
import os
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

from piidetector import models


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    gliner_snapshot = snapshot_download(models.GLINER_MODEL, revision=models.GLINER_REVISION)
    tracer_snapshot = snapshot_download(models.TRACER_MODEL, revision=models.TRACER_REVISION)

    from gliner import GLiNER

    model = GLiNER.from_pretrained(gliner_snapshot)
    model.eval()
    used = None
    for opset in (19, 17, 14):
        try:
            model.export_to_onnx(out, onnx_filename="model.onnx", quantize=False, opset=opset)
            used = opset
            break
        except Exception as e:  # noqa: BLE001
            print(f"export failed at opset {opset}: {type(e).__name__}", flush=True)
    if used is None:
        sys.exit("ONNX export failed at every opset")
    print("exported opset", used, "files", sorted(p.name for p in out.iterdir()), flush=True)
    del model

    from transformers import AutoModel

    AutoModel.from_pretrained(tracer_snapshot, trust_remote_code=True)

    os.environ["HF_HUB_OFFLINE"] = "1"
    GLiNER.from_pretrained(str(out), load_onnx_model=True, onnx_model_file="model.onnx", local_files_only=True)
    print("onnx reload ok", flush=True)
    (out / "export_info.json").write_text(
        json.dumps(
            {"opset": used, "gliner_revision": models.GLINER_REVISION, "tracer_revision": models.TRACER_REVISION}
        )
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
