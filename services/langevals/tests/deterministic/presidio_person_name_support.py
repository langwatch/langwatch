"""The evaluator, span helper and corpus bounds the Presidio name tests share."""

from functools import lru_cache

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
