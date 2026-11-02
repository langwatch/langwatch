"""The two models of Level 1: GLiNER multi-PII (fp32 ONNX) and PII-Tracer (torch, CPU, fp32).

Both wrappers cut long texts into overlapping windows, run the model per window, shift the
spans back to text offsets and keep the highest-scoring span where windows disagree. The
window sizes, overlaps, thresholds and pinned revisions below are the ones the benchmark
measured; changing any of them changes the output.

Heavy imports (onnxruntime, gliner, torch, transformers) happen inside the constructors, so the
rest of the service and its tests import this module without them.

Spans are `{start, end, label, score}` with labels already mapped to the service's label set.
"""

import contextlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

GLINER_MODEL = "urchade/gliner_multi_pii-v1"  # Apache-2.0
GLINER_REVISION = "1fcf13e85f4eef5394e1fcd406cf2ca9ea82351d"
GLINER_THRESHOLD = 0.10066250711679459
GLINER_MAX_WORDS = 384  # words per window
GLINER_OVERLAP = 64  # words shared by neighbouring windows
GLINER_LABELS_PER_CALL = 25  # the 33 label prompts go in two calls: 25 + 8

TRACER_MODEL = "perplexity-ai/PII-Tracer"  # MIT
TRACER_REVISION = "d25c16f2e57e321f6d2527715c01df9112f956f5"
TRACER_MAX_TOKENS = 4096
TRACER_OVERLAP = 64
TRACER_LABEL_MAP = {
    "private_person": "PERSON_NAME",
    "private_email": "EMAIL",
    "private_phone": "PHONE",
    "private_address": "STREET_ADDRESS",
}


def overlaps(a, b):
    return a["start"] < b["end"] and b["start"] < a["end"]


def merge_highest_score(spans):
    """Keep non-overlapping spans, highest score first (a missing score counts as 1.0), then the
    longer span, then the earlier one. Returned in text order."""
    ranked = sorted(
        spans,
        key=lambda x: (-(x["score"] if x.get("score") is not None else 1.0), -(x["end"] - x["start"]), x["start"]),
    )
    kept = []
    for s in ranked:
        if not any(overlaps(s, k) for k in kept):
            kept.append(s)
    return sorted(kept, key=lambda x: (x["start"], x["end"]))


def _no_grad():
    try:
        import torch

        return torch.no_grad()
    except ImportError:
        return contextlib.nullcontext()


def load_gliner_labels(path=None):
    labels = json.loads(Path(path or HERE / "gliner_labels.json").read_text())
    return labels["prompts"], labels["label_map"]


class Gliner:
    """GLiNER multi-PII over an ONNX export made at image build time (scripts/build_assets.py)."""

    name = "gliner"

    def __init__(self, onnx_dir, threads, labels_path=None):
        import onnxruntime as ort
        from gliner import GLiNER

        self.prompts, self.label_map = load_gliner_labels(labels_path)
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = int(threads)
        so.inter_op_num_threads = 1
        self.model = GLiNER.from_pretrained(
            str(onnx_dir),
            load_onnx_model=True,
            onnx_model_file="model.onnx",
            local_files_only=True,
            session_options=so,
        )
        self.splitter = self.model.data_processor.words_splitter
        self.batch = GLINER_LABELS_PER_CALL

    def windows(self, text):
        """Character ranges of windows of GLINER_MAX_WORDS words, GLINER_OVERLAP words apart."""
        toks = [(s, e) for _, s, e in self.splitter(text)]
        if len(toks) <= GLINER_MAX_WORDS:
            return [(0, len(text))]
        step, out = GLINER_MAX_WORDS - GLINER_OVERLAP, []
        for i in range(0, len(toks), step):
            chunk = toks[i : i + GLINER_MAX_WORDS]
            out.append((chunk[0][0], chunk[-1][1]))
            if i + GLINER_MAX_WORDS >= len(toks):
                break
        return out

    def predict(self, text):
        if not text.strip():
            return []
        found = []
        with _no_grad():
            for a, b in self.windows(text):
                chunk = text[a:b]
                for i in range(0, len(self.prompts), self.batch):
                    for e in self.model.predict_entities(
                        chunk, self.prompts[i : i + self.batch], threshold=GLINER_THRESHOLD, flat_ner=True
                    ):
                        found.append(
                            {
                                "start": a + e["start"],
                                "end": a + e["end"],
                                "label": self.label_map.get(e["label"], e["label"]),
                                "score": float(e["score"]),
                            }
                        )
        return merge_highest_score(found)


class Tracer:
    """PII-Tracer on CPU in fp32. The model ships its own code (trust_remote_code), pinned by revision
    and baked into the image, so nothing is fetched at run time."""

    name = "tracer"

    def __init__(self, threads=None):
        import torch
        from huggingface_hub import snapshot_download
        from transformers import AutoModel

        if threads:
            torch.set_num_threads(int(threads))
        path = snapshot_download(TRACER_MODEL, revision=TRACER_REVISION, local_files_only=True)
        self.model = AutoModel.from_pretrained(path, trust_remote_code=True).to("cpu").eval()
        self.model.float()
        self.tok = self.model.tokenizer

    def _spans(self, text):
        with _no_grad():
            out = self.model.predict(text)
        spans = out[0] if isinstance(out, tuple) else out
        return [
            {
                "start": int(x.start),
                "end": int(x.end),
                "label": TRACER_LABEL_MAP.get(x.label, x.label),
                "score": float(x.score) if getattr(x, "score", None) is not None else None,
            }
            for x in spans
        ]

    def predict(self, text):
        if not text.strip():
            return []
        enc = self.tok(text, return_offsets_mapping=True, add_special_tokens=False)
        offs = [o for o in enc["offset_mapping"] if o[1] > o[0]]
        size = TRACER_MAX_TOKENS - 8  # room for the special tokens the model adds
        if len(offs) <= size:
            return self._spans(text)
        step, found = size - TRACER_OVERLAP, []
        for i in range(0, len(offs), step):
            ch = offs[i : i + size]
            a, b = ch[0][0], ch[-1][1]
            for sp in self._spans(text[a:b]):
                sp["start"] += a
                sp["end"] += a
                found.append(sp)
            if i + size >= len(offs):
                break
        return merge_highest_score(found)
