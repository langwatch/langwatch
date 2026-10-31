"""Presidio person-name recall per casing class, against the Titlecase control.

A hit is a PERSON span over the whole name, in the 117-201 character band the
leaked values had. Rates: specs/evaluators/langevals-presidio-allcaps-person-names.feature
"""

import json

import pytest

from presidio_person_name_support import (
    LENGTH_BAND,
    MIN_THRESHOLD,
    evaluator,
    person_spans,
)

# Every gate sits one case under its measured value, so runner drift cannot flip it.
PASS_RATE = 0.95  # control 47/48

# A floor, not a target: lowercase has no name cue to restore. Tracked: langwatch/tasks#1055.
LOWERCASE_REGRESSION_FLOOR = 35 / 48  # measured 36/48

# The particle control's own ceiling is 21/24: the stock recogniser truncates
# 'Marcus Van Der Berg' to 'Marcus Van Der' at any casing (langwatch/tasks#1057).
PARTICLE_PASS_RATE = 20 / 24
PARTICLE_LOWERCASE_REGRESSION_FLOOR = 11 / 24  # measured 12/24

SHORT_PASS_RATE = 23 / 24  # control 24/24
SHORT_LOWERCASE_REGRESSION_FLOOR = 21 / 24  # measured 22/24

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

# Particle surnames (van, de, bin, mac) are a corpus of their own, so a regression
# confined to short tokens cannot hide inside the 48-case single-word average.
PARTICLE_FORENAMES = [
    "Marcus", "Elena", "Rafael", "Ingrid", "Noemi", "Tobias", "Priya", "Dmitri",
    "Yusuf", "Bianca", "Soren", "Amara", "Lucas", "Freya", "Hector", "Nadia",
    "Oscar", "Linnea", "Emeric", "Sofia", "Rowan", "Tamsin", "Casper", "Mireia",
]

PARTICLE_SURNAMES = [
    "Van Der Berg", "Von Trapp", "Del Toro", "De Vries", "La Fontaine",
    "Van Houten", "Von Eschenbach", "De Luca", "Del Rosario", "Den Hartog",
    "Ter Horst", "Ten Brink", "Dos Santos", "Das Neves", "Bin Rashid",
    "Ibn Khalil", "Al Mansouri", "Mac Gowan", "St Clair", "De La Cruz",
    "Van De Velde", "Von Rothenberg", "De Angelis", "Ten Cate",
]

PARTICLE_NAMES = list(zip(PARTICLE_FORENAMES, PARTICLE_SURNAMES, strict=True))

# A forename or surname under four letters, in three groups of eight, since
# the shape rule treats a short capitalised word apart from a long one.
SHORT_NAMES = [
    ("Amy", "Whitfield"), ("Ian", "Carrington"), ("Eva", "Lindqvist"), ("Kai", "Nakamura"),
    ("Max", "Halvorsen"), ("Zoe", "Delacroix"), ("Ben", "Bergstrom"), ("Ana", "Castellanos"),
    ("Marcus", "Lee"), ("Elena", "Ng"), ("Priya", "Wu"), ("Tobias", "Fox"),
    ("Ingrid", "Kay"), ("Rafael", "Ito"), ("Noemi", "Roy"), ("Dmitri", "Orr"),
    ("Amy", "Lee"), ("Ian", "Wu"), ("Eva", "Ng"), ("Kai", "Fox"),
    ("Max", "Kay"), ("Zoe", "Ito"), ("Ben", "Roy"), ("Ana", "Orr"),
]

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


def build_cases(
    casing_class: str,
    names: list[tuple[str, str]] | None = None,
) -> list[tuple[str, str]]:
    """Return (rendered_name, json_context) for every base name in one class."""
    render = CASING_CLASSES[casing_class]
    cases = []
    for index, (forename, surname) in enumerate(BASE_NAMES if names is None else names):
        name = render(forename, surname)
        template = CONTEXT_TEMPLATES[index % len(CONTEXT_TEMPLATES)]
        cases.append((name, template.format(name=name)))
    return cases


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

    assert len(PARTICLE_NAMES) >= 20, "particle corpus too small for a figure"
    assert all(" " in surname for _f, surname in PARTICLE_NAMES), (
        "a particle surname has to be more than one token or it measures nothing"
    )

    assert len(SHORT_NAMES) >= 20, "short-name corpus too small for a figure"
    assert all(
        min(len(forename), len(surname)) < 4 for forename, surname in SHORT_NAMES
    ), "a short name needs a word under four letters or it measures nothing"

    corpus_size = len(BASE_NAMES) + len(PARTICLE_NAMES) + len(SHORT_NAMES)
    seen_texts = set()
    for casing_class in CASING_CLASSES:
        cases = (
            build_cases(casing_class)
            + build_cases(casing_class, names=PARTICLE_NAMES)
            + build_cases(casing_class, names=SHORT_NAMES)
        )
        assert len(cases) == corpus_size
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

    assert len(seen_texts) == corpus_size * len(CASING_CLASSES)


def _recall_table(names: list[tuple[str, str]]) -> dict[str, dict[str, int]]:
    table = {}
    for casing_class in CASING_CLASSES:
        counts = {"full": 0, "partial": 0, "none": 0}
        for name, text in build_cases(casing_class, names=names):
            counts[coverage(name, text)] += 1
        table[casing_class] = counts
    return table


def _print_recall_table(title: str, names: list[tuple[str, str]]) -> dict:
    table = _recall_table(names)
    total = len(names)
    header = f"{'casing class':<40}{'full':>6}{'partial':>9}{'none':>6}{'n':>5}{'recall':>9}"
    print(f"\n{title}, min_threshold={MIN_THRESHOLD}, n={total} per class")
    print(header)
    print("-" * len(header))
    for casing_class, counts in table.items():
        marker = "  <- control" if casing_class == CONTROL_CLASS else ""
        print(
            f"{casing_class:<40}{counts['full']:>6}{counts['partial']:>9}"
            f"{counts['none']:>6}{total:>5}{counts['full'] / total:>8.1%}{marker}"
        )
    return table


def test_recall_per_casing_class_table():
    """Print the table, and refuse to call an unanalysed corpus a finding."""
    table = _print_recall_table("Presidio PERSON recall", BASE_NAMES)
    _print_recall_table(
        "Presidio PERSON recall, particle surnames", PARTICLE_NAMES
    )
    _print_recall_table("Presidio PERSON recall, short names", SHORT_NAMES)

    total = len(BASE_NAMES)
    analysed = sum(c["full"] + c["partial"] for c in table.values())
    assert analysed > 0, "no PERSON span anywhere: the analyzer did not run"
    control_recall = table[CONTROL_CLASS]["full"] / total
    assert control_recall >= 0.90, (
        f"control class recall {control_recall:.1%} is too low for the other "
        "classes to be interpreted: the model or environment is wrong, not the casing"
    )


def _assert_recalled(
    casing_class: str, index: int, names: list[tuple[str, str]] | None = None
):
    name, text = build_cases(casing_class, names=names)[index]
    assert coverage(name, text) == "full", (
        f"{casing_class}: no PERSON span covers {name!r} in {text!r} "
        f"(spans found: {person_spans(text)})"
    )


# @scenario "An ordinarily capitalised name is still detected"
@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_titlecase_forename_titlecase_surname(index: int):
    """Control: the ceiling the other three classes are measured against."""
    _assert_recalled(CONTROL_CLASS, index)


# @scenario "A capitalised surname is detected as reliably as an ordinary one"
@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_titlecase_forename_allcaps_surname(index: int):
    """The shape that dominated the production misses."""
    _assert_recalled("titlecase_forename_allcaps_surname", index)


# @scenario "A wholly capitalised name is detected as reliably as an ordinary one"
@pytest.mark.pass_rate(PASS_RATE)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_allcaps_forename_allcaps_surname(index: int):
    _assert_recalled("allcaps_forename_allcaps_surname", index)


# @scenario "A lowercase name is held at its measured floor, not raised"
@pytest.mark.pass_rate(LOWERCASE_REGRESSION_FLOOR)
@pytest.mark.parametrize("index", range(len(BASE_NAMES)))
def test_recall_lowercase_forename_lowercase_surname(index: int):
    """Floor, not a target: see LOWERCASE_REGRESSION_FLOOR and tasks#1055."""
    _assert_recalled("lowercase_forename_lowercase_surname", index)


# Particle surnames: the same four classes, gated one case under the particle control.


# @scenario "An ordinarily capitalised name is still detected"
@pytest.mark.pass_rate(PARTICLE_PASS_RATE)
@pytest.mark.parametrize("index", range(len(PARTICLE_NAMES)))
def test_recall_particle_titlecase_forename_titlecase_surname(index: int):
    """Control for the particle corpus: see PARTICLE_PASS_RATE."""
    _assert_recalled(CONTROL_CLASS, index, names=PARTICLE_NAMES)


# @scenario "A capitalised surname is detected as reliably as an ordinary one"
@pytest.mark.pass_rate(PARTICLE_PASS_RATE)
@pytest.mark.parametrize("index", range(len(PARTICLE_NAMES)))
def test_recall_particle_titlecase_forename_allcaps_surname(index: int):
    """Held at the particle control: the side-by-side clause closed this gap."""
    _assert_recalled(
        "titlecase_forename_allcaps_surname", index, names=PARTICLE_NAMES
    )


# @scenario "A wholly capitalised name is detected as reliably as an ordinary one"
@pytest.mark.pass_rate(PARTICLE_PASS_RATE)
@pytest.mark.parametrize("index", range(len(PARTICLE_NAMES)))
def test_recall_particle_allcaps_forename_allcaps_surname(index: int):
    """Held at the particle control. This was the worst class on this corpus,
    2 of 24, and the side-by-side clause took it to the ceiling."""
    _assert_recalled(
        "allcaps_forename_allcaps_surname", index, names=PARTICLE_NAMES
    )


# @scenario "A lowercase name is held at its measured floor, not raised"
@pytest.mark.pass_rate(PARTICLE_LOWERCASE_REGRESSION_FLOOR)
@pytest.mark.parametrize("index", range(len(PARTICLE_NAMES)))
def test_recall_particle_lowercase_forename_lowercase_surname(index: int):
    """Floor, not a target: see LOWERCASE_REGRESSION_FLOOR and tasks#1055."""
    _assert_recalled(
        "lowercase_forename_lowercase_surname", index, names=PARTICLE_NAMES
    )


# Short names: the same four classes, gated one case under the short control.


# @scenario "An ordinarily capitalised name is still detected"
@pytest.mark.pass_rate(SHORT_PASS_RATE)
@pytest.mark.parametrize("index", range(len(SHORT_NAMES)))
def test_recall_short_titlecase_forename_titlecase_surname(index: int):
    _assert_recalled(CONTROL_CLASS, index, names=SHORT_NAMES)


# @scenario "A capitalised surname is detected as reliably as an ordinary one"
@pytest.mark.pass_rate(SHORT_PASS_RATE)
@pytest.mark.parametrize("index", range(len(SHORT_NAMES)))
def test_recall_short_titlecase_forename_allcaps_surname(index: int):
    _assert_recalled("titlecase_forename_allcaps_surname", index, names=SHORT_NAMES)


# @scenario "A wholly capitalised name is detected as reliably as an ordinary one"
@pytest.mark.pass_rate(SHORT_PASS_RATE)
@pytest.mark.parametrize("index", range(len(SHORT_NAMES)))
def test_recall_short_allcaps_forename_allcaps_surname(index: int):
    """5 of 24 before two short capitalised words side by side counted as a name."""
    _assert_recalled("allcaps_forename_allcaps_surname", index, names=SHORT_NAMES)


# @scenario "A lowercase name is held at its measured floor, not raised"
@pytest.mark.pass_rate(SHORT_LOWERCASE_REGRESSION_FLOOR)
@pytest.mark.parametrize("index", range(len(SHORT_NAMES)))
def test_recall_short_lowercase_forename_lowercase_surname(index: int):
    """Floor, not a target: see LOWERCASE_REGRESSION_FLOOR and tasks#1055."""
    _assert_recalled("lowercase_forename_lowercase_surname", index, names=SHORT_NAMES)
