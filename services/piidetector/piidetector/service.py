"""The request contract shared by the Lambda handler and the HTTP server.

Request, one of:
    {"texts": ["...", ...], "level": 0 | 1}
        -> {"level": 1, "results": [{"spans": [Span, ...]}, ...]}
    {"texts": ["...", ...], "components": ["level0", "gliner"]}       (split layout, see combine.py)
        -> {"components": [...], "results": [{"parts": {"level0": [...], "gliner": [...]}}, ...]}

Span = {"start": int, "end": int, "label": str, "score": float | null, "source": str}. Offsets
are Python string indices (code points) into the text. `results` follows the order of `texts`.
A text that fails gets {"error": "<exception class name>"} and no spans; the message is never
returned or logged because it can quote the text.

Configuration (environment):
    PII_COMPONENTS  what this process loads at start: a comma list of level0, gliner, tracer.
                    Default all three. A request needing a component that is not loaded is refused.
    THREADS         CPU threads for the models. Default: the CPUs this process may run on.
    ONNX_DIR        the GLiNER ONNX export. Default /opt/onnx/gliner (where the image puts it).
    PII_WARMUP      1 (default) runs one short synthetic sentence through each model at start,
                    so the first real request does not pay for lazy initialisation.

Only counts and timings are logged, never text or spans.
"""

import json
import os
import time

from . import combine

WARMUP_TEXT = "Hello, this is a warm-up sentence for Alice Example."


class BadRequest(ValueError):
    """The request is malformed or asks for something this process cannot do."""


def cpu_threads():
    v = os.environ.get("THREADS", "").strip()
    if v.isdigit() and int(v) > 0:
        return int(v)
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except AttributeError:
        return max(1, os.cpu_count() or 1)


def pin_threads(threads):
    """Must run before torch or onnxruntime is imported: their thread pools read these at import."""
    for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "TORCH_NUM_THREADS"):
        os.environ[k] = str(threads)
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def configured_components():
    raw = os.environ.get("PII_COMPONENTS", ",".join(combine.COMPONENTS))
    comps = [c.strip() for c in raw.split(",") if c.strip()]
    unknown = [c for c in comps if c not in combine.COMPONENTS]
    if unknown:
        raise ValueError("unknown component in PII_COMPONENTS: " + ",".join(unknown))
    return comps


def log(**fields):
    print(json.dumps(fields), flush=True)


def _ms(t0):
    return round((time.perf_counter() - t0) * 1000, 3)


class Detector:
    """The loaded models of one process and the request handling around them."""

    def __init__(self, components, gliner=None, tracer=None, threads=None):
        self.components = list(components)
        self.gliner = gliner
        self.tracer = tracer
        self.threads = threads
        self.init_ms = {}

    @classmethod
    def from_environment(cls):
        threads = cpu_threads()
        pin_threads(threads)
        components = configured_components()
        detector = cls(components, threads=threads)
        detector.load()
        return detector

    def load(self):
        from . import models  # the model libraries load only in processes that need them

        if "gliner" in self.components or "tracer" in self.components:
            import torch

            torch.set_num_threads(self.threads)
        if "gliner" in self.components:
            t0 = time.perf_counter()
            self.gliner = models.Gliner(os.environ.get("ONNX_DIR", "/opt/onnx/gliner"), self.threads)
            self.init_ms["gliner"] = _ms(t0)
        if "tracer" in self.components:
            t0 = time.perf_counter()
            self.tracer = models.Tracer(self.threads)
            self.init_ms["tracer"] = _ms(t0)
        if os.environ.get("PII_WARMUP", "1") == "1":
            for model in (self.gliner, self.tracer):
                if model is not None:
                    model.predict(WARMUP_TEXT)
        log(event="init", components=self.components, threads=self.threads, init_ms=self.init_ms)

    def _check_loaded(self, needed):
        missing = [c for c in needed if c != "level0" and getattr(self, c) is None]
        if missing:
            raise BadRequest("not loaded in this process: " + ",".join(missing))

    def handle(self, request):
        t0 = time.perf_counter()
        if not isinstance(request, dict):
            raise BadRequest("request must be a JSON object")
        texts = request.get("texts")
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            raise BadRequest("texts must be a list of strings")
        if "components" in request and "level" in request:
            raise BadRequest("send either level or components, not both")
        if "components" in request:
            response = self._handle_components(texts, request["components"])
        else:
            response = self._handle_level(texts, request.get("level"))
        log(
            event="request",
            n_texts=len(texts),
            n_errors=sum(1 for r in response["results"] if "error" in r),
            ms=_ms(t0),
        )
        return response

    def _handle_level(self, texts, level):
        if type(level) is not int or level not in combine.LEVELS:
            raise BadRequest("level must be 0 or 1")
        self._check_loaded(combine.LEVEL_COMPONENTS[level])
        results = []
        for text in texts:
            try:
                results.append({"spans": combine.detect(text, level, gliner=self.gliner, tracer=self.tracer)})
            except Exception as e:  # noqa: BLE001  class name only: messages can quote the text
                results.append({"error": type(e).__name__})
        return {"level": level, "results": results}

    def _handle_components(self, texts, components):
        if not isinstance(components, list) or not components or any(c not in combine.COMPONENTS for c in components):
            raise BadRequest("components must be a non-empty list of: " + ", ".join(combine.COMPONENTS))
        self._check_loaded(components)
        results = []
        for text in texts:
            try:
                results.append(
                    {"parts": combine.run_components(text, components, gliner=self.gliner, tracer=self.tracer)}
                )
            except Exception as e:  # noqa: BLE001  class name only: messages can quote the text
                results.append({"error": type(e).__name__})
        return {"components": components, "results": results}
