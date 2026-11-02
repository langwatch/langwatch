"""The invariants of the ALL-CAPS second pass, apart from how well it scores.

Same length, skip when it cannot help, PERSON and LOCATION only, the name-shape
and name-word rules, one entry per name. Why each holds:
specs/evaluators/langevals-presidio-allcaps-person-names.feature
"""

import sys
import unicodedata
from typing import Any

import pytest
from langevals_presidio.allcaps_names import (
    MIN_NORMALISED_TOKEN_LENGTH,
    MIN_SPAN_WORDS,
    normalise_allcaps_runs,
)
from langevals_presidio.pii_detection import (
    PresidioEntities,
    PresidioPIIDetectionEntry,
    PresidioPIIDetectionEvaluator,
)
from presidio_analyzer import RecognizerResult
from presidio_person_name_support import (
    MIN_THRESHOLD,
    analyze_calls,
    evaluator,
    name_and_place_evaluator,
)

# U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE. Its lowercase mapping is two
# characters, 'i' plus U+0307, which is what makes a naive lower() or title()
# shift every offset after it.
DOTTED_CAPITAL_I = "İ"


def findings(
    text: str, subject: PresidioPIIDetectionEvaluator | None = None
) -> list[tuple[str, str]]:
    """(entity type, covered text) for every finding, in the order reported."""
    result = (subject or evaluator()).evaluate(PresidioPIIDetectionEntry(input=text))
    assert result.status == "processed", f"evaluator did not run: {result}"
    return [
        (f["entity_type"], text[f["start"]:f["end"]])
        for f in result.raw_response["results"]
    ]


def names_and_places(text: str) -> list[tuple[str, str]]:
    return [
        (entity, covered)
        for entity, covered in findings(text, name_and_place_evaluator())
        if entity in ("PERSON", "LOCATION")
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


# @scenario "The second pass also looks for places when places are redacted"
def test_second_pass_asks_for_places_when_location_is_on():
    calls = analyze_calls(
        entities=PresidioEntities(person=True, location=True),
        text="MARCUS WHITFIELD asked about the renewal of his annual plan.",
    )
    assert len(calls) == 2, f"expected two passes, got {len(calls)}: {calls}"
    assert calls[1]["entities"] == ["PERSON", "LOCATION"]


# @scenario "The second pass is skipped when the only capitals are short words"
@pytest.mark.parametrize(
    "text",
    [
        "Marcus Whitfield said OK, the ID is on the USD invoice from the CFO.",
        "Marcus Whitfield restarted the TCP/IP stack on the VM.",
    ],
)
def test_no_second_pass_when_only_short_words_are_capitalised(text: str):
    calls = analyze_calls(entities=PresidioEntities(person=True), text=text)
    assert len(calls) == 1, f"expected one pass, got {len(calls)}: {calls}"


# @scenario "The second pass is skipped when every capitalised word is its own field"
@pytest.mark.parametrize(
    "text",
    [
        '{"method": "POST", "url": "/v1/chat/completions", "status": 200}',
        '{"level": "ERROR", "message": "upstream timed out after 30s"}',
        '{"tool": "search", "args": {"query": "refund policy"}, "status": "SUCCESS"}',
        '{"env": "PROD", "region": "eu-west-1", "service": "checkout"}',
        '{"first": "Maria", "last": "GONZALEZ"}',
        '["Maria", "GONZALEZ"]',
        "{'method': 'POST', 'url': '/v1', 'level': 'ERROR'}",
        '"method"; "POST"; "status"; "SUCCESS"',
        "{“method”: “POST”, “level”: “ERROR”}",
        "{‘method’: ‘POST’, ‘level’: ‘ERROR’}",
        '{method: "POST", level: "ERROR"}',
    ],
)
def test_no_second_pass_when_every_capitalised_word_is_its_own_field(text: str):
    """A quote beside a colon, comma or semicolon ends a field, so a quoted POST
    is not worth a pass."""
    calls = analyze_calls(
        entities=PresidioEntities(person=True, location=True), text=text
    )
    assert len(calls) == 1, f"expected one pass, got {len(calls)}: {calls}"


# @scenario "The second pass still runs for a capitalised word that may join another"
@pytest.mark.parametrize(
    "text,name",
    [
        ('{"customer": "MARIA GONZALEZ", "status": "OPEN"}', "MARIA GONZALEZ"),
        ("Escalated by Anna Smith-JONES.", "Anna Smith-JONES"),
        ("Note: AMY LEE called twice.", "AMY LEE"),
        ("Signed by J. WHITFIELD on arrival.", "J. WHITFIELD"),
        ('JOHN "JACK" WHITFIELD', 'JOHN "JACK" WHITFIELD'),
        ('Customer: Robert "BOB" MILLER', 'Robert "BOB" MILLER'),
        ("Ann – WHITFIELD", "Ann – WHITFIELD"),
        ("Ann - WHITFIELD", "Ann - WHITFIELD"),
        ("Contact Robert: MILLER", "Robert: MILLER"),
        ("JAMES' WHITFIELD", "JAMES' WHITFIELD"),
        ("Contact person: Robert (MILLER), phone unknown", "Robert (MILLER"),
    ],
)
def test_second_pass_runs_for_a_capitalised_word_that_may_join_another(
    text: str, name: str
):
    calls = analyze_calls(
        entities=PresidioEntities(person=True, location=True), text=text
    )
    assert len(calls) == 2, f"expected two passes, got {len(calls)}: {calls}"
    assert ("PERSON", name) in names_and_places(text)


# @scenario "The second pass still runs for a capitalised word that may join another"
def test_second_pass_runs_for_a_surname_before_a_comma():
    """Only the comma joins GONZALEZ to a word. Just the forename is redacted
    today (#9255)."""
    calls = analyze_calls(
        entities=PresidioEntities(person=True, location=True),
        text='{"name": "GONZALEZ, Maria"}',
    )
    assert len(calls) == 2, f"expected two passes, got {len(calls)}: {calls}"


# @scenario "The second pass is skipped when neither names nor places are redacted"
def test_no_second_pass_when_person_and_location_are_disabled():
    calls = analyze_calls(
        entities=PresidioEntities(person=False, location=False),
        text="MARCUS WHITFIELD asked about the renewal of his annual plan.",
    )
    assert len(calls) == 1, f"expected one pass, got {len(calls)}: {calls}"
    assert "PERSON" not in calls[0]["entities"]
    assert "LOCATION" not in calls[0]["entities"]


# @scenario "The second pass asks only for places when only places are redacted"
def test_second_pass_asks_only_for_places_when_person_is_off():
    calls = analyze_calls(
        entities=PresidioEntities(person=False, location=True),
        text="MARCUS WHITFIELD asked about the renewal of his annual plan.",
    )
    assert len(calls) == 2, f"expected two passes, got {len(calls)}: {calls}"
    assert calls[1]["entities"] == ["LOCATION"]


# ---------------------------------------------------------------------------
# 3. PERSON and LOCATION only, union only
# ---------------------------------------------------------------------------

# Every other entity is in ALL-CAPS context; only the second pass finds the name.
MIXED_ENTITY_TEXT = (
    "CONTACT RECORD: Tobias OKONKWO, email TOBIAS.OKONKWO@EXAMPLE.COM, "
    "IBAN GB33BUKB20201555555555, card 4111 1111 1111 1111, HOST 203.0.113.42."
)


# @scenario "Only name and place spans come out of the second pass"
def test_the_second_pass_adds_a_name_and_changes_nothing_else():
    """Other spans are compared against the analyzer in the next test."""
    assert person_names(MIXED_ENTITY_TEXT) == ["Tobias OKONKWO"]


# @scenario "Only name and place spans come out of the second pass"
def test_other_entities_match_the_first_pass_exactly():
    """Against the analyzer called directly, not a copy with the second pass removed."""
    subject = name_and_place_evaluator()
    entities = [
        name.upper()
        for name, enabled in subject.settings.entities.model_dump().items()
        if enabled
    ]
    first_pass = [
        (result.entity_type, MIXED_ENTITY_TEXT[result.start:result.end])
        for result in subject.analyzer.analyze(
            text=MIXED_ENTITY_TEXT, entities=entities, language="en"
        )
        if result.score >= MIN_THRESHOLD
        and result.entity_type not in ("PERSON", "LOCATION")
    ]
    assert first_pass, "the text must carry another entity to measure"
    assert [
        f
        for f in findings(MIXED_ENTITY_TEXT, subject)
        if f[0] not in ("PERSON", "LOCATION")
    ] == first_pass


class AnalyzerThatAddsAnEmail:
    """Passes calls through, and on the normalised copy also calls the name an email."""

    def __init__(self, inner: Any, original: str, span: tuple[int, int]):
        self._inner = inner
        self._original = original
        self._span = span

    def analyze(self, **kwargs: Any) -> Any:
        results = list(self._inner.analyze(**kwargs))
        if kwargs["text"] != self._original:
            start, end = self._span
            results.append(RecognizerResult("EMAIL_ADDRESS", start, end, 1.0))
        return results


# @scenario "Only name and place spans come out of the second pass"
def test_a_non_name_span_from_the_second_pass_is_dropped():
    """Whatever the analyzer returns on the normalised copy, only names and
    places are taken from it, even on a span shaped and worded like a name."""
    start = MIXED_ENTITY_TEXT.index("Tobias OKONKWO")
    span = (start, start + len("Tobias OKONKWO"))
    subject = name_and_place_evaluator()
    inner = PresidioPIIDetectionEvaluator.analyzer
    PresidioPIIDetectionEvaluator.analyzer = AnalyzerThatAddsAnEmail(  # type: ignore[assignment]
        inner, MIXED_ENTITY_TEXT, span
    )
    try:
        found = findings(MIXED_ENTITY_TEXT, subject)
    finally:
        PresidioPIIDetectionEvaluator.analyzer = inner  # type: ignore[assignment]
    assert ("EMAIL_ADDRESS", "Tobias OKONKWO") not in found
    assert ("PERSON", "Tobias OKONKWO") in found


# @scenario "A surname the model reads as a place is still redacted in capitals"
def test_a_capitalised_surname_read_as_a_place_is_redacted():
    """Titlecase Costa Pereira is a LOCATION to the model, so a PERSON-only
    second pass left it in clear when written in capitals."""
    titlecase = "Account holder Maria Fernanda Costa Pereira asked to close the account."
    capitals = "Account holder Maria Fernanda COSTA PEREIRA asked to close the account."
    assert ("LOCATION", "Costa Pereira") in names_and_places(titlecase)
    assert names_and_places(capitals) == [
        ("PERSON", "Maria Fernanda"),
        ("LOCATION", "COSTA PEREIRA"),
    ]


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


# @scenario "Capitalised words that are not name words are not harvested"
@pytest.mark.parametrize(
    "phrase",
    [
        "WIDGET PRO",  # a long product word: the 4+ letter clause alone let it through
        "SEPA ACH",  # two acronyms side by side
        "API KEY",  # an acronym and an everyday word, read as a place
    ],
)
@pytest.mark.parametrize(
    "template",
    [
        "Hi, this is {phrase}, my parcel has not arrived and the tracking page shows no update.",
        "Thanks for waiting. I checked the order history for {phrase} and it ships tomorrow.",
    ],
)
def test_capitalised_non_name_words_are_not_harvested(template: str, phrase: str):
    text = template.format(phrase=phrase)
    assert names_and_places(text) == [], f"a name or place was invented in {phrase}"


PLAN_TEMPLATE = "Please confirm whether {name} should stay on the current plan."


# @scenario "A name made only of everyday words is not harvested in capitals"
@pytest.mark.parametrize("name", ["ROSE WHITE", "GRACE BROWN", "HOPE STONE"])
def test_a_name_of_everyday_words_is_the_accepted_price(name: str):
    """The measured cost of the name-word rule, pinned so a change shows.

    The model's corpus writes both words more often in lowercase, so nothing
    tells them from WIDGET PRO.
    """
    assert person_names(PLAN_TEMPLATE.format(name=name)) == []


# @scenario "A name made only of everyday words is not harvested in capitals"
def test_one_name_word_beside_an_everyday_word_is_enough():
    """GRACE alone is everyday; NWOSU makes it a name. The first pass misses it,
    so this is the second pass and the rule at work."""
    text = PLAN_TEMPLATE.format(name="GRACE NWOSU")
    analyzer = PresidioPIIDetectionEvaluator.analyzer
    assert not [
        r
        for r in analyzer.analyze(text=text, entities=["PERSON"], language="en")
        if r.score >= MIN_THRESHOLD
    ], "the first pass must miss it for this to test the second"
    assert person_names(text) == ["GRACE NWOSU"]


# @scenario "A short name the corpus mostly writes as another word is still harvested"
@pytest.mark.parametrize("name", ["HUNG NGO", "WOO SEO", "MIN SONG", "CEM TAN"])
def test_a_short_name_read_as_an_acronym_or_word_is_harvested(name: str):
    """NGO and SEO are acronyms in the corpus, Hung and Song everyday words.
    The name list keeps them; without it all four stay in clear."""
    assert person_names(PLAN_TEMPLATE.format(name=name)) == [name]


# @scenario "A listed name that is also an everyday word does not make a name of everyday words"
@pytest.mark.parametrize(
    "text,phrase",
    [
        ("Order 4412: RAM MODULE replaced, follow-up booked.", "RAM MODULE"),
        ("Order 4412: BIN LOCATION replaced, follow-up booked.", "BIN LOCATION"),
        ("Order 4412: SKU BIN LOCATION A4 MAN HOURS replaced.", "SKU BIN LOCATION A4 MAN HOURS"),
    ],
)
def test_a_listed_everyday_word_beside_an_everyday_word_is_not_harvested(text: str, phrase: str):
    """RAM, BIN and LONG are listed surnames and everyday words alike."""
    assert names_and_places(text) == [], f"a name or place was invented in {phrase}"


# @scenario "A listed name that is also an everyday word does not make a name of everyday words"
def test_a_name_of_listed_words_only_is_still_harvested():
    """SONG and TAN are everyday words too; with only listed words, they count."""
    assert person_names(PLAN_TEMPLATE.format(name="MIN SONG")) == ["MIN SONG"]
    assert person_names(PLAN_TEMPLATE.format(name="CEM TAN")) == ["CEM TAN"]


# @scenario "An unknown word beside an everyday word is not harvested"
@pytest.mark.parametrize(
    "text,phrase",
    [
        ("Customer ZORBEX ULTRA called about the refund.", "ZORBEX ULTRA"),
        ("Shipped with KORVATH EXPRESS this morning.", "KORVATH EXPRESS"),
        ("Product FROSTWYN HOODIE out of stock.", "FROSTWYN HOODIE"),
    ],
)
def test_an_invented_brand_beside_an_everyday_word_is_not_harvested(text: str, phrase: str):
    assert names_and_places(text) == [], f"a name or place was invented in {phrase}"


# @scenario "A name of words the model has never seen is still harvested"
@pytest.mark.parametrize("name", ["TAVRIK ZOLNEY", "ZELIMIR VRAKHOV"])
def test_a_name_of_unknown_words_is_harvested(name: str):
    assert person_names(PLAN_TEMPLATE.format(name=name)) == [name]


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


# @scenario "The evaluator redacts a name whose surname is written in capitals"
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
