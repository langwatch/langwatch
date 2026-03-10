import dotenv
from unittest.mock import patch, MagicMock
import numpy as np

dotenv.load_dotenv()

from langevals_langevals.sentiment import (
    SentimentEvaluator,
    SentimentEntry,
    SentimentSettings,
    NEGATIVE_REFERENCE,
    POSITIVE_REFERENCE,
)


def _normalize(values: list[float]) -> list[float]:
    vec = np.array(values)
    return (vec / np.linalg.norm(vec)).tolist()


def _evaluate_with_mock_embeddings(
    input_text: str,
    input_vec: list[float],
    positive_ref: list[float] = None,
    negative_ref: list[float] = None,
):
    """Run the evaluator with mocked embeddings to avoid real API calls."""
    if positive_ref is None:
        positive_ref = _normalize([1.0, 0.0, 0.0])
    if negative_ref is None:
        negative_ref = _normalize([0.0, 1.0, 0.0])

    evaluator = SentimentEvaluator(
        settings=SentimentSettings(embeddings_model="openai/text-embedding-3-small")
    )
    entry = SentimentEntry(input=input_text)

    embeddings_by_text = {
        NEGATIVE_REFERENCE: negative_ref,
        POSITIVE_REFERENCE: positive_ref,
    }

    def mock_embedding(model, input, **kwargs):
        text = input if isinstance(input, str) else input[0]
        response = MagicMock()
        response.data = [{"embedding": embeddings_by_text.get(text, input_vec)}]
        return response

    with patch("langevals_langevals.sentiment.litellm") as mock_litellm:
        mock_litellm.embedding = mock_embedding
        mock_litellm.encode = MagicMock(return_value=[1] * 10)
        return evaluator.evaluate(entry)


class TestSentimentEvaluator:
    class TestWhenInputIsPositive:
        def test_returns_positive_label(self):
            result = _evaluate_with_mock_embeddings(
                input_text="I love this product, it is amazing!",
                input_vec=_normalize([0.95, 0.05, 0.0]),
            )

            assert result.status == "processed"
            assert result.label == "positive"
            assert result.score > 0

        def test_returns_score_close_to_one(self):
            result = _evaluate_with_mock_embeddings(
                input_text="I love this product, it is amazing!",
                input_vec=_normalize([0.99, 0.01, 0.0]),
            )

            assert result.status == "processed"
            assert result.score > 0.5

    class TestWhenInputIsNegative:
        def test_returns_negative_label(self):
            result = _evaluate_with_mock_embeddings(
                input_text="This is terrible, I hate it!",
                input_vec=_normalize([0.05, 0.95, 0.0]),
            )

            assert result.status == "processed"
            assert result.label == "negative"
            assert result.score < 0

    class TestWhenInputIsEmpty:
        def test_returns_skipped(self):
            evaluator = SentimentEvaluator(
                settings=SentimentSettings(embeddings_model="openai/text-embedding-3-small")
            )
            entry = SentimentEntry(input="")
            result = evaluator.evaluate(entry)

            assert result.status == "skipped"
            assert result.details == "No input text to evaluate"

    class TestWhenInputExceedsMaxTokens:
        def test_returns_skipped(self):
            evaluator = SentimentEvaluator(
                settings=SentimentSettings(embeddings_model="openai/text-embedding-3-small")
            )
            entry = SentimentEntry(input="lorem ipsum dolor " * 100000)

            with patch("langevals_langevals.sentiment.litellm") as mock_litellm:
                mock_litellm.encode = MagicMock(return_value=list(range(200000)))
                result = evaluator.evaluate(entry)

            assert result.status == "skipped"
            assert "tokens" in result.details

    class TestScoreNormalization:
        def test_score_is_between_negative_one_and_one(self):
            result = _evaluate_with_mock_embeddings(
                input_text="Neutral text about weather",
                input_vec=_normalize([0.5, 0.5, 0.0]),
            )

            assert result.status == "processed"
            assert -1.0 <= result.score <= 1.0

        def test_score_is_clamped_to_one(self):
            result = _evaluate_with_mock_embeddings(
                input_text="Extremely positive text",
                input_vec=_normalize([1.0, 0.0, 0.0]),
            )

            assert result.status == "processed"
            assert result.score == 1.0

        def test_score_is_clamped_to_negative_one(self):
            result = _evaluate_with_mock_embeddings(
                input_text="Extremely negative text",
                input_vec=_normalize([0.0, 1.0, 0.0]),
            )

            assert result.status == "processed"
            assert result.score == -1.0
