import json
import logging
import os
from typing import Any, Literal, Optional
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResult,
    EvaluationResultSkipped,
)
from pydantic import BaseModel, Field
import spacy
import spacy.cli
from spacy.strings import hash_string
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_analyzer.nlp_engine import SpacyNlpEngine

# Presidio's analyzer emits a WARNING for every requested entity that has
# no recognizer in the active language. Our entity list intentionally
# includes language-region specific types (SG_NRIC_FIN, AU_ABN, IN_PAN,
# ...) that are absent from en, so each English call produced ~30 warning
# lines. At lambda invocation volumes this was producing 13+ GB/day of
# CloudWatch noise with no signal value: the "missing recognizer" facts
# are static, not per-request, and known at configuration time.
logging.getLogger("presidio-analyzer").setLevel(logging.ERROR)


PERSON_ENTITY = "PERSON"
LOCATION_ENTITY = "LOCATION"

# The entities spaCy's NER finds, and so the ones that read capitals as a cue.
# LOCATION is here because the model splits a name across both: in Titlecase
# it reads Maria Fernanda as a person and Costa Pereira as a place.
CASE_SENSITIVE_ENTITIES = (PERSON_ENTITY, LOCATION_ENTITY)

# The shape a harvested span needs to be a name and not a titlecased acronym.
# Measured bounds and their trade-offs: specs/evaluators/langevals-presidio-allcaps-person-names.feature
MIN_SPAN_WORDS = 2
MIN_NORMALISED_TOKEN_LENGTH = 4

# A word reads as a name when the model's corpus writes it in Titlecase this
# many times more often than in lowercase or in capitals. Pro (Titlecase
# 1.2x) is not one; Lee (19x) is. Measured: same feature file.
NAME_FORM_DOMINANCE = 1.5


def _is_upper_letter(character: str) -> bool:
    return character.isalpha() and character.isupper()


def _is_word_char(character: str) -> bool:
    return character.isalnum() or character == "_"


def normalise_allcaps_runs(text: str) -> str:
    """Titlecase every whole-word run of two or more capitals, keeping the length.

    U+0130 (lowercase is two characters) stays as it is, and a run touching a
    letter, digit or underscore (ACME_CORP_LTD) is not a word.
    """
    characters = list(text)
    total = len(characters)
    index = 0
    while index < total:
        starts_word = index == 0 or not _is_word_char(characters[index - 1])
        if not _is_upper_letter(characters[index]) or not starts_word:
            index += 1
            continue

        run_end = index
        while run_end < total and _is_upper_letter(characters[run_end]):
            run_end += 1
        ends_word = run_end == total or not _is_word_char(characters[run_end])

        if run_end - index >= 2 and ends_word:
            for position in range(index + 1, run_end):
                lowered = characters[position].lower()
                if len(lowered) == 1:
                    characters[position] = lowered

        index = max(run_end, index + 1)

    return "".join(characters)


def _word_runs(text: str) -> list[tuple[int, int]]:
    """Every maximal run of word characters, as (start, end) into `text`."""
    runs: list[tuple[int, int]] = []
    start: Optional[int] = None
    for index, character in enumerate(text):
        if _is_word_char(character):
            if start is None:
                start = index
        elif start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, len(text)))
    return runs


def _rewritten_runs(*, original: str, normalised: str) -> list[tuple[int, int]]:
    """The word runs normalisation changed, as (start, end) into both texts."""
    return [
        (run_start, run_end)
        for run_start, run_end in _word_runs(original)
        if original[run_start:run_end] != normalised[run_start:run_end]
    ]


def _has_name_shaped_rewrite(*, original: str, normalised: str) -> bool:
    """A rewritten word of 4+ letters, or two rewritten words side by side.

    The second clause is AMY LEE and VAN DER BERG; a lone short one is the CFO.
    """
    rewritten = _rewritten_runs(original=original, normalised=normalised)
    if any(end - start >= MIN_NORMALISED_TOKEN_LENGTH for start, end in rewritten):
        return True
    return any(
        original[left_end:right_start].isspace()
        for (_, left_end), (right_start, _) in zip(rewritten, rewritten[1:])
    )


def _frequency_rank(vectors: Any, form: str) -> float:
    """The form's row in the frequency-sorted vector table, or infinity if absent.

    Looked up by hash so an unseen word is not added to the shared vocab.
    """
    row = vectors.key2row.get(hash_string(form), -1)
    return float("inf") if row < 0 else float(row)


def _reads_as_name(word: str, vectors: Any) -> bool:
    """Whether the model's corpus writes `word` mostly in Titlecase.

    Names are; product words (WIDGET), acronyms (SEPA, API) and everyday
    words (KEY) are not. A word in no form at all is rare, so most likely a
    name, and is kept.
    """
    title = _frequency_rank(vectors, word[:1].upper() + word[1:].lower())
    other = min(
        _frequency_rank(vectors, word.lower()),
        _frequency_rank(vectors, word.upper()),
    )
    if title == other == float("inf"):
        return True
    return title * NAME_FORM_DOMINANCE < other


def _normalisation_justifies_span(
    *, original: str, normalised: str, start: int, end: int, vectors: Any
) -> bool:
    """Whether a span found only after normalisation is shaped and worded like a name.

    Titlecasing restores the cue on WHITFIELD and invents one on CEO and on
    WIDGET PRO. Measured bounds: specs/evaluators/langevals-presidio-allcaps-person-names.feature
    """
    span = original[start:end]
    if len(span.split()) < MIN_SPAN_WORDS:
        return False
    if not _has_name_shaped_rewrite(original=span, normalised=normalised[start:end]):
        return False
    return any(
        _reads_as_name(span[word_start:word_end], vectors)
        for word_start, word_end in _word_runs(span)
        if span[word_start:word_end].isalpha()
    )


def _covers(outer: Any, inner: Any) -> bool:
    return outer.start <= inner.start and outer.end >= inner.end


class PresidioPIIDetectionEntry(EvaluatorEntry):
    input: Optional[str] = None
    output: Optional[str] = None


class PresidioEntities(BaseModel):
    credit_card: bool = True
    crypto: bool = True
    email_address: bool = True
    iban_code: bool = True
    ip_address: bool = True
    location: bool = False
    person: bool = False
    phone_number: bool = True
    medical_license: bool = True
    us_bank_number: bool = False
    us_driver_license: bool = False
    us_itin: bool = False
    us_passport: bool = False
    us_ssn: bool = False
    uk_nhs: bool = False
    sg_nric_fin: bool = False
    au_abn: bool = False
    au_acn: bool = False
    au_tfn: bool = False
    au_medicare: bool = False
    in_pan: bool = False
    in_aadhaar: bool = False
    in_vehicle_registration: bool = False
    in_voter: bool = False
    in_passport: bool = False


class PresidioPIIDetectionSettings(EvaluatorSettings):
    entities: PresidioEntities = Field(
        default=PresidioEntities(),
        description="The types of PII to check for in the input.",
    )
    min_threshold: float = Field(
        default=0.5,
        description="The minimum confidence required for failing the evaluation on a PII match.",
    )


class PresidioPIIDetectionResult(EvaluationResult):
    score: float = Field(description="Amount of PII detected, 0 means no PII detected")
    passed: Optional[bool] = Field(
        description="If true then no PII was detected, if false then at least one PII was detected",
        default=None,
    )
    raw_response: dict[str, Any]


class PresidioPIIDetectionEvaluator(
    BaseEvaluator[
        PresidioPIIDetectionEntry,
        PresidioPIIDetectionSettings,
        PresidioPIIDetectionResult,
    ]
):
    """
    Detects personally identifiable information in text, including phone numbers, email addresses, and
    social security numbers. It allows customization of the detection threshold and the specific types of PII to check.
    """

    name = "Presidio PII Detection"
    category = "safety"
    env_vars = []
    default_settings = PresidioPIIDetectionSettings()
    docs_url = "https://microsoft.github.io/presidio"
    is_guardrail = True

    @classmethod
    def preload(cls):
        # Try loading in order: 1) as installed package, 2) from cache, 3) download
        model_loaded = False
        cache_dir = os.path.join(os.path.dirname(__file__), ".cache")

        # First, try loading as an installed package (when en-core-web-lg is a dependency)
        try:
            spacy.load("en_core_web_lg")
            model_loaded = True
        except OSError:
            pass

        # Second, try loading from local cache
        if not model_loaded:
            os.makedirs(cache_dir, exist_ok=True)
            try:
                spacy.load(os.path.join(cache_dir, "en_core_web_lg"))
                model_loaded = True
            except OSError:
                pass

        # Last resort: download and cache
        if not model_loaded:
            spacy.cli.download("en_core_web_lg", False, False, "--no-cache-dir")  # type: ignore
            nlp = spacy.load("en_core_web_lg")
            nlp.to_disk(os.path.join(cache_dir, "en_core_web_lg"))

        nlp_engine = SpacyNlpEngine(
            models=[{"lang_code": "en", "model_name": "en_core_web_lg"}]
        )
        cls.analyzer = AnalyzerEngine(nlp_engine=nlp_engine)
        cls.word_vectors = nlp_engine.nlp["en"].vocab.vectors

        super().preload()

    def _results_from_normalised_casing(
        self, *, content: str, entities: list[str], already_found: list[Any]
    ) -> list[Any]:
        """The `entities` spans only a case-normalised copy of `content` sees.

        `entities` is case-sensitive only: the code, currency and identifier
        recognisers need the capitals. Skipped when the text has no name-shaped
        rewrite, since no span could pass without one.
        """
        normalised = normalise_allcaps_runs(content)
        if not _has_name_shaped_rewrite(original=content, normalised=normalised):
            return []

        placed = {
            (result.entity_type, result.start, result.end)
            for result in already_found
        }
        return [
            result
            for result in self.analyzer.analyze(
                text=normalised, entities=entities, language="en"
            )
            if result.score >= self.settings.min_threshold
            and (result.entity_type, result.start, result.end) not in placed
            and _normalisation_justifies_span(
                original=content,
                normalised=normalised,
                start=result.start,
                end=result.end,
                vectors=self.word_vectors,
            )
        ]

    def _merge_normalised_results(
        self, *, content: str, entities: list[str], results: list[Any]
    ) -> list[Any]:
        """`results` with the normalised copy's case-sensitive spans folded in.

        Where two case-sensitive spans overlap by cover, only the wider
        survives, so `score` counts each name or place once and redaction
        reaches the whole of it.
        """
        additions = self._results_from_normalised_casing(
            content=content, entities=entities, already_found=results
        )
        if not additions:
            return results

        case_sensitive = [
            result
            for result in results
            if result.entity_type in CASE_SENSITIVE_ENTITIES
        ]
        kept_additions = [
            addition
            for addition in additions
            if not any(_covers(result, addition) for result in case_sensitive)
        ]
        superseded = {
            id(result)
            for result in case_sensitive
            if any(_covers(addition, result) for addition in kept_additions)
        }
        return [
            result for result in results if id(result) not in superseded
        ] + kept_additions

    def evaluate(self, entry: PresidioPIIDetectionEntry) -> SingleEvaluationResult:
        content = "\n\n".join([entry.input or "", entry.output or ""]).strip()
        try:
            json.loads(content)
            content = (
                content.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
            )
            is_valid_json = True
        except:
            is_valid_json = False

        if not content:
            return EvaluationResultSkipped(details="Input and output are both empty")

        settings_entities = self.settings.entities.model_dump()
        entities = [
            info_type.upper()
            for info_type in settings_entities.keys()
            if settings_entities[info_type]
        ]

        if len(content) > 524288:
            raise ValueError(
                "Content exceeds the maximum length of 524288 bytes allowed by PII Detection"
            )

        results = self.analyzer.analyze(text=content, entities=entities, language="en")
        results = [
            result for result in results if result.score >= self.settings.min_threshold
        ]

        case_sensitive = [
            entity for entity in CASE_SENSITIVE_ENTITIES if entity in entities
        ]
        if case_sensitive:
            results = self._merge_normalised_results(
                content=content, entities=case_sensitive, results=results
            )

        findings = [
            f"{result.entity_type} (likelihood: {result.score})" for result in results
        ]

        anonymizer = AnonymizerEngine()
        anonymized_text = anonymizer.anonymize(
            text=content,
            analyzer_results=results,  # type: ignore
        ).text

        if is_valid_json:
            anonymized_text = (
                anonymized_text.replace("\n", "\\n")
                .replace("\t", "\\t")
                .replace("\r", "\\r")
            )

        serialized_results = [result.to_dict() for result in results]

        return PresidioPIIDetectionResult(
            score=len(results),
            passed=len(results) == 0,
            details=(
                None if len(results) == 0 else f"PII detected: {', '.join(findings)}"
            ),
            raw_response={
                "results": serialized_results,
                "anonymized": anonymized_text,
            },
        )
