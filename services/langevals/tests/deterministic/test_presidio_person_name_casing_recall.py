"""Recall of the Presidio person-name detector, measured per casing class.

Why this file exists
--------------------
Strict PII redaction was observed leaving person names in the clear while the
same name value was redacted elsewhere under the same policy. The dominant
shape among the affected values was a Titlecase forename followed by an
ALLCAPS surname. Three candidate fixes were on the table (casing
normalisation with offset mapping, a custom recogniser or context words,
per-entity threshold tuning). Every one of them changes detection for every
tenant and cannot be undone for spans already stored, so the first step is a
number per casing class rather than a guess.

What it measures
----------------
One corpus of `len(BASE_NAMES)` synthetic base names, each rendered in four
casing classes, embedded in JSON-shaped context. A case counts as recalled
only when a PERSON span survives `min_threshold` AND covers the whole name,
forename through surname. A span that covers only the forename is counted
separately as `partial`: redaction driven by it still writes the surname out
in the clear, so it is not a hit.

Titlecase + Titlecase is the control. The same base names run in every class,
so the control fixes the ceiling the stock recogniser can reach on this
corpus, and any gap below it in another class is attributable to casing
alone rather than to names the model has never seen.

Why the 117-201 character band
------------------------------
The values that survived redaction in production were 117 to 201 characters
long, which is well under the evaluator's 524288-byte ceiling. Holding the
corpus inside that same band keeps a size or truncation budget out of the
result: a miss here cannot be explained by length, because these lengths are
the lengths that missed in production. The names also sit inside JSON fields
with ordinary context words around them, because the production values did;
a bare-value corpus would measure a different thing.

Why the pass rate is PASS_RATE
------------------------------
It is the control class's own measured level, not a round number. A name
should be caught as reliably when its surname is capitalised as when it is
not, so the control is the only defensible target. At the time of writing
only the control class clears it; the other three classes fail, which is the
finding this file was written to record. A rate that the ALLCAPS classes
already satisfied would measure nothing.

Running it
----------
    cd services/langevals
    uv sync --extra presidio
    uv run pytest -s -vv tests/deterministic/test_presidio_person_name_casing_recall.py

`uv sync --extra presidio` is required: `langevals_presidio` is not in the
root project's default dependency set, so a bare `uv sync` leaves this file
unimportable. CI's install step already runs `uv sync --all-extras
--all-groups`, so it is covered there.
"""

import json
import logging
from functools import lru_cache

import pytest

from langevals_presidio.pii_detection import (
    PresidioEntities,
    PresidioPIIDetectionEntry,
    PresidioPIIDetectionEvaluator,
    PresidioPIIDetectionSettings,
)

# The evaluator silences this logger at import. Presidio uses it to say an
# entity has no recogniser for the language, and with it silenced a
# structurally undetectable entity is indistinguishable from a recall miss.
logging.getLogger("presidio-analyzer").setLevel(logging.WARNING)

MIN_THRESHOLD = 0.5
PASS_RATE = 0.95
LENGTH_BAND = (117, 201)

FORENAMES = [
    "Marcus", "Elena", "Priya", "Tobias", "Ingrid", "Rafael", "Noemi", "Dmitri",
    "Yusuf", "Bianca", "Soren", "Amara", "Lucas", "Freya", "Hector", "Nadia",
    "Oscar", "Linnea", "Emeric", "Sofia", "Rowan", "Tamsin", "Casper", "Mireia",
    "Anton", "Delia", "Kwame", "Lorenzo", "Maja", "Niamh", "Otto", "Paloma",
    "Quentin", "Rosalind", "Stellan", "Thandiwe", "Ulrik", "Verena", "Wendell",
    "Xiomara", "Yannick", "Zara", "Benedikt", "Clarissa", "Dorian", "Evelina",
    "Fabio", "Greta",
]

SURNAMES = [
    "Whitfield", "Carrington", "Lindqvist", "Okonkwo", "Nakamura", "Halvorsen",
    "Delacroix", "Bergstrom", "Castellanos", "Abernathy", "Fairbanks",
    "Hollingsworth", "Vandermeer", "Rosenthal", "Thornbury", "Mortensen",
    "Eriksson", "Dubois", "Ferreira", "Novakova", "Larsson", "Beaumont",
    "Ashworth", "Kaplanoglu", "Brennan", "Sandoval", "Virtanen", "Molnar",
    "Achterberg", "Baptiste", "Cavendish", "Drummond", "Engstrom",
    "Fiorentino", "Grimaldi", "Haverford", "Ibarra", "Jernigan", "Kowalczyk",
    "Lefevre", "Maddox", "Nilsson", "Oyelaran", "Pritchard", "Quintero",
    "Radcliffe", "Stavropoulos", "Tennyson",
]

# Synthetic pairings, deliberately mixed across origins so no row reads as a
# real or public person. The surnames are ordinary enough that the control
# class can reach its ceiling; an invented surname would depress every class
# equally and hide the casing effect.
BASE_NAMES = list(zip(FORENAMES, SURNAMES, strict=True))

# JSON-shaped, ordinary context words, no other PII type in the string: a
# second entity would let a non-PERSON hit be mistaken for a name hit.
CONTEXT_TEMPLATES = [
    '{{"ticket": "SR-4821", "channel": "support_email", "note": "The account holder {name} asked about the delayed refund and wants a callback."}}',
    '{{"record": "case-7730", "stage": "review", "comment": "Our agent confirmed that {name} is the primary contact for this billing enquiry."}}',
    '{{"thread": "msg-1192", "role": "assistant", "content": "I have passed your request on to {name}, who handles renewals, and they will reply shortly."}}',
    '{{"event": "note_added", "source": "crm", "body": "A short summary was written by {name} after the call about the shipping delay and the refund."}}',
    '{{"form": "intake-55", "step": "verify", "answer": "Please confirm whether {name} should stay on the current plan for the coming renewal."}}',
    '{{"audit": "entry-8140", "actor": "agent", "detail": "The note records that {name} was told the replacement part would arrive in the next window."}}',
]

CASING_CLASSES = {
    "titlecase_forename_titlecase_surname": lambda f, s: f"{f} {s}",
    "titlecase_forename_allcaps_surname": lambda f, s: f"{f} {s.upper()}",
    "allcaps_forename_allcaps_surname": lambda f, s: f"{f.upper()} {s.upper()}",
    "lowercase_forename_lowercase_surname": lambda f, s: f"{f.lower()} {s.lower()}",
}

CONTROL_CLASS = "titlecase_forename_titlecase_surname"


def build_cases(casing_class: str) -> list[tuple[str, str]]:
    """Return (rendered_name, json_context) for every base name in one class."""
    render = CASING_CLASSES[casing_class]
    cases = []
    for index, (forename, surname) in enumerate(BASE_NAMES):
        name = render(forename, surname)
        template = CONTEXT_TEMPLATES[index % len(CONTEXT_TEMPLATES)]
        cases.append((name, template.format(name=name)))
    return cases


@lru_cache(maxsize=1)
def evaluator() -> PresidioPIIDetectionEvaluator:
    return PresidioPIIDetectionEvaluator(
        settings=PresidioPIIDetectionSettings(
            entities=PresidioEntities(person=True),
            min_threshold=MIN_THRESHOLD,
        )
    )


@lru_cache(maxsize=None)
def person_spans(text: str) -> tuple[tuple[int, int, float], ...]:
    """PERSON spans the real evaluator reports, after its own threshold filter."""
    result = evaluator().evaluate(PresidioPIIDetectionEntry(input=text))
    assert result.status == "processed", f"evaluator did not run: {result}"
    return tuple(
        (finding["start"], finding["end"], finding["score"])
        for finding in result.raw_response["results"]
        if finding["entity_type"] == "PERSON"
    )


def coverage(name: str, text: str) -> str:
    """'full' when a PERSON span covers the whole name, else 'partial' or 'none'."""
    start = text.index(name)
    end = start + len(name)
    spans = person_spans(text)
    if any(span_start <= start and span_end >= end for span_start, span_end, _ in spans):
        return "full"
    if any(span_start < end and span_end > start for span_start, span_end, _ in spans):
        return "partial"
    return "none"


def test_person_entity_is_structurally_detectable():
    """A missing recogniser would make every miss below meaningless."""
    recognizers = evaluator().analyzer.registry.get_recognizers(
        language="en", entities=["PERSON"]
    )
    assert recognizers, "no PERSON recogniser for en: recall is unmeasurable, not low"
    print(f"\nPERSON recognisers for en: {[r.name for r in recognizers]}")


def test_corpus_is_not_vacuous():
    """Stop the harness reporting recall over an empty or malformed corpus."""
    assert len(BASE_NAMES) >= 40, "corpus too small for a per-class figure"
    assert len(CASING_CLASSES) == 4

    seen_texts = set()
    for casing_class in CASING_CLASSES:
        cases = build_cases(casing_class)
        assert len(cases) == len(BASE_NAMES)
        for name, text in cases:
            assert text.count(name) == 1, f"name not uniquely locatable: {name!r}"
            assert LENGTH_BAND[0] <= len(text) <= LENGTH_BAND[1], (
                f"{len(text)} chars is outside the production band {LENGTH_BAND}: {text!r}"
            )
            json.loads(text)
            # evaluate() unescapes \\n \\t \\r on JSON content; if it rewrote
            # these strings the offsets we compare against would be stale.
            assert text == text.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
            seen_texts.add(text)

    assert len(seen_texts) == len(BASE_NAMES) * len(CASING_CLASSES)


def test_recall_per_casing_class_table():
    """Print the table, and refuse to call an unanalysed corpus a finding."""
    table = {}
    for casing_class in CASING_CLASSES:
        counts = {"full": 0, "partial": 0, "none": 0}
        for name, text in build_cases(casing_class):
            counts[coverage(name, text)] += 1
        table[casing_class] = counts

    total = len(BASE_NAMES)
    header = f"{'casing class':<40}{'full':>6}{'partial':>9}{'none':>6}{'n':>5}{'recall':>9}"
    print(f"\nPresidio PERSON recall, min_threshold={MIN_THRESHOLD}, n={total} per class")
    print(header)
    print("-" * len(header))
    for casing_class, counts in table.items():
        marker = "  <- control" if casing_class == CONTROL_CLASS else ""
        print(
            f"{casing_class:<40}{counts['full']:>6}{counts['partial']:>9}"
            f"{counts['none']:>6}{total:>5}{counts['full'] / total:>8.1%}{marker}"
        )

    analysed = sum(c["full"] + c["partial"] for c in table.values())
    assert analysed > 0, "no PERSON span anywhere: the analyzer did not run"
    control_recall = table[CONTROL_CLASS]["full"] / total
    assert control_recall >= 0.90, (
        f"control class recall {control_recall:.1%} is too low for the other "
        "classes to be interpreted: the model or environment is wrong, not the casing"
    )


def _assert_recalled(casing_class: str, index: int):
    name, text = build_cases(casing_class)[index]
    assert coverage(name, text) == "full", (
        f"{casing_class}: no PERSON span covers {name!r} in {text!r} "
        f"(spans found: {person_spans(text)})"
    )


@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_titlecase_forename_titlecase_surname(index: int):
    """Control: the ceiling the other three classes are measured against."""
    _assert_recalled(CONTROL_CLASS, index)


@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_titlecase_forename_allcaps_surname(index: int):
    """The shape that dominated the production misses."""
    _assert_recalled("titlecase_forename_allcaps_surname", index)


@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_allcaps_forename_allcaps_surname(index: int):
    _assert_recalled("allcaps_forename_allcaps_surname", index)


@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_lowercase_forename_lowercase_surname(index: int):
    _assert_recalled("lowercase_forename_lowercase_surname", index)
