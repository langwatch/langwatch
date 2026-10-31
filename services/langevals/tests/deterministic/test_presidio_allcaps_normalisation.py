"""The invariants of the ALL-CAPS second pass, apart from how well it scores.

Same length, skip when it cannot help, PERSON only, the name-shape rule, one
entry per name. Why each holds: specs/evaluators/langevals-presidio-allcaps-person-names.feature
"""

import sys
import unicodedata
from typing import Any

import pytest

from langevals_presidio.pii_detection import (
    MIN_NORMALISED_TOKEN_LENGTH,
    MIN_SPAN_WORDS,
    PresidioEntities,
    PresidioPIIDetectionEntry,
    PresidioPIIDetectionEvaluator,
    PresidioPIIDetectionSettings,
    normalise_allcaps_runs,
)
from presidio_person_name_support import MIN_THRESHOLD, evaluator

# U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE. Its lowercase mapping is two
# characters, 'i' plus U+0307, which is what makes a naive lower() or title()
# shift every offset after it.
DOTTED_CAPITAL_I = "İ"


class CountingAnalyzer:
    """Passes every call through and records how many there were."""

    def __init__(self, inner: Any):
        self._inner = inner
        self.calls: list[dict[str, Any]] = []

    def analyze(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self._inner.analyze(**kwargs)


def analyze_calls(*, entities: PresidioEntities, text: str) -> list[dict[str, Any]]:
    """Every analyze() call one evaluate() of `text` makes.

    The counter goes on the class: the pydantic evaluator refuses instance attributes.
    """
    subject = PresidioPIIDetectionEvaluator(
        settings=PresidioPIIDetectionSettings(
            entities=entities, min_threshold=MIN_THRESHOLD
        )
    )
    inner = PresidioPIIDetectionEvaluator.analyzer
    counting = CountingAnalyzer(inner)
    PresidioPIIDetectionEvaluator.analyzer = counting  # type: ignore[assignment]
    try:
        result = subject.evaluate(PresidioPIIDetectionEntry(input=text))
    finally:
        PresidioPIIDetectionEvaluator.analyzer = inner  # type: ignore[assignment]
    assert result.status == "processed", f"evaluator did not run: {result}"
    return counting.calls


def findings(text: str) -> list[tuple[str, str]]:
    """(entity type, covered text) for every finding, in the order reported."""
    result = evaluator().evaluate(PresidioPIIDetectionEntry(input=text))
    assert result.status == "processed", f"evaluator did not run: {result}"
    return [
        (f["entity_type"], text[f["start"]:f["end"]])
        for f in result.raw_response["results"]
    ]


def person_names(text: str) -> list[str]:
    return [covered for entity, covered in findings(text) if entity == "PERSON"]


# ---------------------------------------------------------------------------
# 1. Length preservation
# ---------------------------------------------------------------------------


# @scenario "Case normalisation never changes the length of the text"
def test_naive_casing_changes_length_where_normalisation_does_not():
    """The concrete character where lower() and title() break the offsets."""
    subject = f"DM{DOTTED_CAPITAL_I}TR{DOTTED_CAPITAL_I}"

    assert len(subject) == 6
    assert len(subject.lower()) == 8, "pick a different character for this test"
    assert len(subject.title()) == 8
    assert len(subject[0] + subject[1:].lower()) == 8

    normalised = normalise_allcaps_runs(subject)
    assert len(normalised) == len(subject)
    assert normalised == f"Dm{DOTTED_CAPITAL_I}tr{DOTTED_CAPITAL_I}"


# @scenario "Case normalisation never changes the length of the text"
def test_length_is_preserved_across_every_single_character_in_unicode():
    """Not a sample: every code point whose case mapping could drift."""
    offenders: list[str] = []
    multi_character_lower = 0
    for code_point in range(sys.maxunicode + 1):
        character = chr(code_point)
        if not character.isalpha():
            continue
        if len(character.lower()) != 1:
            multi_character_lower += 1
        for subject in (character * 2, f"A{character}", f"{character}A"):
            if len(normalise_allcaps_runs(subject)) != len(subject):
                offenders.append(subject)

    assert offenders == []
    assert multi_character_lower == 1, (
        "Unicode gained another uppercase letter with a multi-character "
        f"lowercase mapping: {multi_character_lower} now"
    )
    assert unicodedata.name(DOTTED_CAPITAL_I) == "LATIN CAPITAL LETTER I WITH DOT ABOVE"


# @scenario "Case normalisation never changes the length of the text"
@pytest.mark.parametrize(
    "subject,expected",
    [
        ("O'BRIEN", "O'Brien"),
        ("VAN DER BERG", "Van Der Berg"),
        ("MARIE-CLAIRE", "Marie-Claire"),
        ("MÜLLER", "Müller"),
        ("ŁUKASZEWICZ", "Łukaszewicz"),
        ("J. WHITFIELD", "J. Whitfield"),
        ("J WHITFIELD", "J Whitfield"),
        ("A.B. CARRINGTON", "A.B. Carrington"),
        ("CEO MARCUS WHITFIELD", "Ceo Marcus Whitfield"),
        ("The CEO is MARCUS WHITFIELD", "The Ceo is Marcus Whitfield"),
        # Left alone: a run that is not a whole word.
        ("McDONALD", "McDONALD"),
        ("IBANs", "IBANs"),
        ("ACME_CORP_LTD", "ACME_CORP_LTD"),
        # A single capital is not a run.
        ("A SMITH", "A Smith"),
        # Not Latin-only: the rule is about capitals, whatever the script.
        ("ΑΘΗΝΑ", "Αθηνα"),
        ("МОСКВА", "Москва"),
    ],
)
def test_normalisation_shape_by_shape(subject: str, expected: str):
    assert normalise_allcaps_runs(subject) == expected
    assert len(normalise_allcaps_runs(subject)) == len(subject)


# ---------------------------------------------------------------------------
# 2. The skip path
# ---------------------------------------------------------------------------


# @scenario "The second pass is skipped when it has nothing to normalise"
def test_no_second_pass_without_an_allcaps_run():
    """One analyze() call, so this fails if the second pass ran unconditionally."""
    calls = analyze_calls(
        entities=PresidioEntities(person=True),
        text="Marcus Whitfield asked about the renewal of his annual plan.",
    )
    assert len(calls) == 1, f"expected one pass, got {len(calls)}: {calls}"


# @scenario "The second pass is skipped when it has nothing to normalise"
def test_second_pass_runs_once_with_an_allcaps_run():
    calls = analyze_calls(
        entities=PresidioEntities(person=True),
        text="MARCUS WHITFIELD asked about the renewal of his annual plan.",
    )
    assert len(calls) == 2, f"expected two passes, got {len(calls)}: {calls}"
    assert calls[1]["entities"] == ["PERSON"]
    assert calls[1]["text"] == "Marcus Whitfield asked about the renewal of his annual plan."


# @scenario "The second pass is skipped when the only capitals are short words"
def test_no_second_pass_when_only_short_words_are_capitalised():
    calls = analyze_calls(
        entities=PresidioEntities(person=True),
        text="Marcus Whitfield said OK, the ID is on the USD invoice from the CFO.",
    )
    assert len(calls) == 1, f"expected one pass, got {len(calls)}: {calls}"


# @scenario "The second pass is skipped when person detection is off"
def test_no_second_pass_when_person_is_disabled():
    calls = analyze_calls(
        entities=PresidioEntities(person=False),
        text="MARCUS WHITFIELD asked about the renewal of his annual plan.",
    )
    assert len(calls) == 1, f"expected one pass, got {len(calls)}: {calls}"
    assert "PERSON" not in calls[0]["entities"]


# ---------------------------------------------------------------------------
# 3. PERSON only, union only
# ---------------------------------------------------------------------------

# Every other entity is in ALL-CAPS context; only the second pass finds the name.
MIXED_ENTITY_TEXT = (
    "CONTACT RECORD: Tobias OKONKWO, email TOBIAS.OKONKWO@EXAMPLE.COM, "
    "IBAN GB33BUKB20201555555555, card 4111 1111 1111 1111, HOST 203.0.113.42."
)


# @scenario "Only person spans come out of the second pass"
def test_the_second_pass_adds_a_name_and_changes_nothing_else():
    """Non-person spans are compared against the analyzer in the next test."""
    assert person_names(MIXED_ENTITY_TEXT) == ["Tobias OKONKWO"]


# @scenario "Only person spans come out of the second pass"
def test_non_person_entities_match_the_first_pass_exactly():
    """Against the analyzer called directly, not a copy with the second pass removed."""
    entities = [
        name.upper()
        for name, enabled in evaluator().settings.entities.model_dump().items()
        if enabled
    ]
    first_pass = [
        (result.entity_type, MIXED_ENTITY_TEXT[result.start:result.end])
        for result in evaluator().analyzer.analyze(
            text=MIXED_ENTITY_TEXT, entities=entities, language="en"
        )
        if result.score >= MIN_THRESHOLD and result.entity_type != "PERSON"
    ]
    assert first_pass, "the text must carry a non-PERSON entity to measure"
    assert [f for f in findings(MIXED_ENTITY_TEXT) if f[0] != "PERSON"] == first_pass


# ---------------------------------------------------------------------------
# 4. The shape rule, and the simplification that would undo it
# ---------------------------------------------------------------------------

# A titlecase forename beside a capitalised surname. Exactly one token here is
# rewritten by normalisation, which is what makes this case the pin.
ONE_REWRITTEN_WORD_TEXT = (
    '{"event": "note_added", "source": "crm", "body": "A short summary was '
    'written by Tobias OKONKWO after the call about the shipping delay and '
    'the refund."}'
)


# @scenario "A name with one capitalised word is still harvested"
def test_a_single_rewritten_token_is_enough():
    """Pins one rewritten token as enough: requiring two drops `Tobias OKONKWO`
    and takes that class from 97.9% back to 81.2% recall, the very defect.
    """
    assert MIN_SPAN_WORDS == 2
    assert MIN_NORMALISED_TOKEN_LENGTH == 4

    assert person_names(ONE_REWRITTEN_WORD_TEXT) == ["Tobias OKONKWO"]


# @scenario "A capitalised name with a surname particle is still harvested"
def test_a_particle_surname_in_capitals_is_harvested():
    text = "Please confirm whether MARCUS VAN DER BERG should stay on the plan."
    assert person_names(text) == ["MARCUS VAN DER BERG"]


# @scenario "A capitalised name made of short words is still harvested"
def test_a_capitalised_name_of_short_words_is_harvested():
    text = "Please confirm whether AMY LEE should stay on the current plan for the renewal."
    assert person_names(text) == ["AMY LEE"]


# @scenario "A titlecased acronym is not harvested as a name"
@pytest.mark.parametrize(
    "text,acronym",
    [
        (
            '{"memo": "M-8801", "body": "The SLA and the KPI dashboard were '
            "reviewed by the PMO before the CAB signed off on the change "
            'request for the ERP rollout."}',
            "ERP",
        ),
        (
            '{"memo": "M-8803", "body": "The RFP was issued to three vendors, '
            "and the SOW will follow once the NDA and the DPA have been "
            'countersigned by both sides."}',
            "NDA",
        ),
        (
            '{"memo": "M-8804", "body": "The CTO asked the CFO whether the ROI '
            "on the CRM migration still held after the VAT change, so the "
            'model was re-run."}',
            "CFO",
        ),
    ],
)
def test_short_titlecased_tokens_are_not_harvested(text: str, acronym: str):
    assert person_names(text) == [], f"a name was invented around {acronym}"


# ---------------------------------------------------------------------------
# 5. One entry per name
# ---------------------------------------------------------------------------


# @scenario "One name is counted once, at its widest span"
def test_a_wider_span_replaces_the_narrower_one_it_covers():
    """`Tobias` and `Tobias OKONKWO` are one person, so one entry."""
    first_pass = [
        ONE_REWRITTEN_WORD_TEXT[result.start:result.end]
        for result in evaluator().analyzer.analyze(
            text=ONE_REWRITTEN_WORD_TEXT, entities=["PERSON"], language="en"
        )
        if result.score >= MIN_THRESHOLD
    ]
    assert first_pass == ["Tobias"], "the first pass must read the forename alone"
    assert person_names(ONE_REWRITTEN_WORD_TEXT) == ["Tobias OKONKWO"]


# @scenario "The analysis service redacts a name whose surname is written in capitals"
def test_a_capitalised_surname_is_redacted_whole():
    result = evaluator().evaluate(
        PresidioPIIDetectionEntry(input=ONE_REWRITTEN_WORD_TEXT)
    )
    assert result.status == "processed", f"evaluator did not run: {result}"
    redacted = result.raw_response["anonymized"]
    assert "Tobias" not in redacted and "OKONKWO" not in redacted, redacted
    assert "written by <PERSON> after the call" in redacted, redacted


# @scenario "One name is counted once, at its widest span"
def test_the_score_counts_distinct_names():
    result = evaluator().evaluate(
        PresidioPIIDetectionEntry(input=ONE_REWRITTEN_WORD_TEXT)
    )
    assert result.status == "processed", f"evaluator did not run: {result}"
    assert result.score == 1, f"one name, so score 1, got {result.score}"
    assert result.details is not None
    assert result.details.count("PERSON") == 1, result.details
