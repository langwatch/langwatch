"""Fakes for the two models, so the tests run without torch, onnxruntime or downloads.

The fakes stand in for the libraries underneath the wrappers in piidetector/models.py, so the
wrappers' own windowing, label mapping and merging run for real.
"""

import re

from piidetector import models


def words(text):
    return [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", text)]


class FakeGlinerLibrary:
    """Stands in for gliner.GLiNER: reports each listed word as a person, per call."""

    def __init__(self, names=("Lucie",)):
        self.names = names
        self.calls = []

    def predict_entities(self, chunk, labels, threshold, flat_ner):
        self.calls.append({"chars": len(chunk), "labels": len(labels), "threshold": threshold, "flat_ner": flat_ner})
        if labels[0] != "person":
            return []
        return [
            {"start": m.start(), "end": m.end(), "label": "person", "score": 0.5}
            for name in self.names
            for m in re.finditer(re.escape(name), chunk)
        ]


def make_gliner(names=("Lucie",)):
    g = models.Gliner.__new__(models.Gliner)
    g.prompts, g.label_map = models.load_gliner_labels()
    g.model, g.splitter, g.batch = FakeGlinerLibrary(names), words, models.GLINER_LABELS_PER_CALL
    return g


class FakeTracerSpan:
    def __init__(self, start, end, label, score):
        self.start, self.end, self.label, self.score = start, end, label, score


class FakeTokenizer:
    def __call__(self, text, return_offsets_mapping, add_special_tokens):
        return {"offset_mapping": [(s, e) for _, s, e in words(text)]}


class FakeTracerLibrary:
    """Stands in for the PII-Tracer model: reports each listed name with its score."""

    tokenizer = FakeTokenizer()

    def __init__(self, names=(("Tomasz", 0.95),)):
        self.names = names

    def predict(self, text):
        spans = [
            FakeTracerSpan(m.start(), m.end(), "private_person", score)
            for name, score in self.names
            for m in re.finditer(re.escape(name), text)
        ]
        return spans, None


def make_tracer(names=(("Tomasz", 0.95),)):
    t = models.Tracer.__new__(models.Tracer)
    t.model = FakeTracerLibrary(names)
    t.tok = t.model.tokenizer
    return t
