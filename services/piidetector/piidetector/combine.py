"""How a level turns component spans into its answer.

Level 0 = the Level 0 detectors alone.

Level 1, per text:
  1. Level 0 spans (regex and validators),
  2. GLiNER spans (all labels),
  3. PII-Tracer spans, keeping only PERSON_NAME spans scored at least TRACER_NAME_MIN_SCORE
     (Tracer is there for the names GLiNER misses or labels as something else),
  4. the union of 1 to 3, where spans with the same (start, end, label) collapse into one,
  5. the name rule over that union, so a name found once is masked everywhere in the text.

Steps 1 to 3 are independent, which is what allows the split layout: one process runs
Level 0 and GLiNER, another runs Tracer, and the caller combines the two answers with
`combine_level1`. Steps 4 and 5 need no model and are cheap.

The output can hold overlapping spans with different labels; a masker should mask the union
of their character ranges.
"""

from . import level0
from .name_rule import RULE_SOURCE, apply_name_rule

LEVELS = (0, 1)
COMPONENTS = ("level0", "gliner", "tracer")
LEVEL_COMPONENTS = {0: ("level0",), 1: COMPONENTS}

# Chosen on a benchmark dev split: the lowest threshold with the best entity leak rate that kept
# over-redaction inside its gate.
TRACER_NAME_MIN_SCORE = 0.8267241716384888

# Public names for `source`. Spans found by several components join them with "+".
SOURCE_LEVEL0 = "level0"
SOURCE_GLINER = "gliner"
SOURCE_TRACER = "tracer"
SOURCE_NAME_RULE = "name_rule"


def level0_spans(text):
    return [
        {"start": s["start"], "end": s["end"], "label": s["label"], "score": s.get("score")}
        for s in level0.detect(text, level0.LEVEL0_DETECTORS)
    ]


def tracer_names(spans):
    return [
        s
        for s in spans
        if s["label"] == "PERSON_NAME" and (s.get("score") is None or s["score"] >= TRACER_NAME_MIN_SCORE)
    ]


def union_spans(parts):
    """`parts` maps a source name to its spans. Spans with the same (start, end, label) collapse to one
    that keeps the highest score; its `source` lists every component that found it."""
    merged = {}
    for source, spans in parts.items():
        for sp in spans:
            key = (sp["start"], sp["end"], sp["label"])
            cur = merged.get(key)
            if cur is None:
                merged[key] = {**sp, "source": source}
            else:
                cur["source"] = cur["source"] + "+" + source
                if sp.get("score") is not None and (cur.get("score") is None or sp["score"] > cur["score"]):
                    cur["score"] = sp["score"]
    return sorted(merged.values(), key=lambda s: (s["start"], s["end"], str(s["label"])))


def _public(span):
    source = SOURCE_NAME_RULE if RULE_SOURCE in (span.get("src") or []) else span["source"]
    return {
        "start": span["start"],
        "end": span["end"],
        "label": span["label"],
        "score": span.get("score"),
        "source": source,
    }


def combine_level0(level0_part):
    return [_public(s) for s in union_spans({SOURCE_LEVEL0: level0_part})]


def combine_level1(text, parts):
    """`parts` holds the raw spans of each component, keyed "level0", "gliner", "tracer"."""
    union = union_spans(
        {
            SOURCE_LEVEL0: parts.get("level0") or [],
            SOURCE_GLINER: parts.get("gliner") or [],
            SOURCE_TRACER: tracer_names(parts.get("tracer") or []),
        }
    )
    return [_public(s) for s in apply_name_rule(text, union)]


def run_components(text, components, gliner=None, tracer=None):
    """Raw spans of each requested component. Model components need their loaded model."""
    parts = {}
    if "level0" in components:
        parts["level0"] = level0_spans(text)
    if "gliner" in components:
        parts["gliner"] = gliner.predict(text)
    if "tracer" in components:
        parts["tracer"] = tracer.predict(text)
    return parts


def detect(text, level, gliner=None, tracer=None):
    """The spans of one text at one level."""
    if level not in LEVELS:
        raise ValueError("level must be 0 or 1")
    parts = run_components(text, LEVEL_COMPONENTS[level], gliner=gliner, tracer=tracer)
    if level == 0:
        return combine_level0(parts["level0"])
    return combine_level1(text, parts)
