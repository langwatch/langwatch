import dotenv
from unittest.mock import patch, MagicMock
import numpy as np

dotenv.load_dotenv()

from langevals_langevals.sentiment import (
    SentimentEvaluator,
    SentimentEntry,
    SentimentSettings,
)


def _normalize(values: list[float]) -> list[float]:
    vec = np.array(values)
    return (vec / np.linalg.norm(vec)).tolist()


def _evaluate_with_mock_embeddings(
    input_text: str,
    input_vec: list[float],
    positive_ref: list[float] = None,
    negative_ref: list[float] = None,
    settings: SentimentSettings = None,
):
    """Run the evaluator with mocked embeddings to avoid real API calls."""
    if positive_ref is None:
        positive_ref = _normalize([1.0, 0.0, 0.0])
    if negative_ref is None:
        negative_ref = _normalize([0.0, 1.0, 0.0])

    if settings is None:
        settings = SentimentSettings(embeddings_model="openai/text-embedding-3-small")

    evaluator = SentimentEvaluator(settings=settings)
    entry = SentimentEntry(input=input_text)

    embeddings_by_text = {
        settings.negative_reference: negative_ref,
        settings.positive_reference: positive_ref,
    }

    def mock_embedding(model, input, **kwargs):
        text = input if isinstance(input, str) else input[0]
        response = MagicMock()
        response.data = [{"embedding": embeddings_by_text.get(text, input_vec)}]
        return response

    with patch("langevals_langevals.sentiment.litellm") as mock_litellm, \
         patch("langevals_langevals.sentiment.get_max_tokens", return_value=8192):
        mock_litellm.embedding = mock_embedding
        mock_litellm.encode = MagicMock(side_effect=lambda model, text: list(range(len(text.split()))))
        mock_litellm.decode = MagicMock(side_effect=lambda model, tokens: " ".join(["word"] * len(tokens)))
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
            result = _evaluate_with_mock_embeddings(
                input_text="lorem ipsum dolor " * 100000,
                input_vec=_normalize([0.7, 0.3, 0.0]),
            )

            assert result.status == "skipped"
            assert "exceeds embedding model limit" in result.details

    class TestWhenCustomReferencesAreProvided:
        def test_uses_custom_references(self):
            settings = SentimentSettings(
                embeddings_model="openai/text-embedding-3-small",
                positive_reference="The customer is delighted with the service",
                negative_reference="The customer is furious about the service",
            )
            result = _evaluate_with_mock_embeddings(
                input_text="Great service!",
                input_vec=_normalize([0.9, 0.1, 0.0]),
                settings=settings,
            )

            assert result.status == "processed"
            assert result.label == "positive"
            assert result.score > 0

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
