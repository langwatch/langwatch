import dotenv
import pytest

dotenv.load_dotenv()

from langevals_presidio.pii_detection import (
    PresidioPIIDetectionEvaluator,
    PresidioPIIDetectionEntry,
    PresidioPIIDetectionSettings,
)


def test_pii_detection():
    entry = PresidioPIIDetectionEntry(input="hey there, my email is foo@bar.com")
    evaluator = PresidioPIIDetectionEvaluator(settings=PresidioPIIDetectionSettings())
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed is False
    assert result.details == "PII detected: EMAIL_ADDRESS (likelihood: 1.0)"


def test_pii_detection_long_context():
    entry = PresidioPIIDetectionEntry(input="lorem ipsum dolor " * 100000)
    evaluator = PresidioPIIDetectionEvaluator(settings=PresidioPIIDetectionSettings())

    with pytest.raises(Exception):
        evaluator.evaluate(entry)


def test_keep_jsons_valid():
    entry = PresidioPIIDetectionEntry(input='{"foo": "bar\\nfoo@bar.com"}')
    evaluator = PresidioPIIDetectionEvaluator(settings=PresidioPIIDetectionSettings())
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed is False
    assert result.details == "PII detected: EMAIL_ADDRESS (likelihood: 1.0)"
    assert result.raw_response["anonymized"] == '{"foo": "bar\\n<EMAIL_ADDRESS>"}'  # type: ignore
