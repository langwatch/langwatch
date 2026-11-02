"""The evaluator, span helper and corpus bounds the Presidio name tests share."""

from functools import cache, lru_cache
from typing import Any

from langevals_presidio.pii_detection import (
    PresidioEntities,
    PresidioPIIDetectionEntry,
    PresidioPIIDetectionEvaluator,
    PresidioPIIDetectionSettings,
)

MIN_THRESHOLD = 0.5

# The character band the leaked production values fell in.
LENGTH_BAND = (117, 201)


@lru_cache(maxsize=1)
def evaluator() -> PresidioPIIDetectionEvaluator:
    return PresidioPIIDetectionEvaluator(
        settings=PresidioPIIDetectionSettings(
            entities=PresidioEntities(person=True),
            min_threshold=MIN_THRESHOLD,
        )
    )


@lru_cache(maxsize=1)
def name_and_place_evaluator() -> PresidioPIIDetectionEvaluator:
    """Person and location both on, as strict redaction asks."""
    return PresidioPIIDetectionEvaluator(
        settings=PresidioPIIDetectionSettings(
            entities=PresidioEntities(person=True, location=True),
            min_threshold=MIN_THRESHOLD,
        )
    )


@cache
def second_pass_places(text: str) -> tuple[str, ...]:
    """LOCATION spans the evaluator reports that the analyzer alone does not."""
    subject = name_and_place_evaluator()
    result = subject.evaluate(PresidioPIIDetectionEntry(input=text))
    assert result.status == "processed", f"evaluator did not run: {result}"
    first_pass = {
        (found.start, found.end)
        for found in subject.analyzer.analyze(
            text=text, entities=["LOCATION"], language="en"
        )
        if found.score >= MIN_THRESHOLD
    }
    return tuple(
        text[finding["start"] : finding["end"]]
        for finding in result.raw_response["results"]
        if finding["entity_type"] == "LOCATION"
        and (finding["start"], finding["end"]) not in first_pass
    )


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


@cache
def person_spans(text: str) -> tuple[tuple[int, int, float], ...]:
    """PERSON spans the real evaluator reports, after its own threshold filter."""
    result = evaluator().evaluate(PresidioPIIDetectionEntry(input=text))
    assert result.status == "processed", f"evaluator did not run: {result}"
    return tuple(
        (finding["start"], finding["end"], finding["score"])
        for finding in result.raw_response["results"]
        if finding["entity_type"] == "PERSON"
    )
