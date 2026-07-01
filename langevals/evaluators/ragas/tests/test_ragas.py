import asyncio
import os
from unittest.mock import patch

import dotenv
import pytest

from langevals_core.base_evaluator import EvaluatorSettings, Money
from langevals_ragas.bleu_score import RagasBLEUScoreEntry, RagasBLEUScoreEvaluator
from langevals_ragas.context_f1 import (
    RagasContextF1Entry,
    RagasContextF1Evaluator,
    RagasContextF1Settings,
)
from langevals_ragas.response_context_precision import (
    RagasResponseContextPrecisionEntry,
    RagasResponseContextPrecisionEvaluator,
)
from langevals_ragas.response_context_recall import (
    RagasResponseContextRecallEntry,
    RagasResponseContextRecallEvaluator,
)
from langevals_ragas.rouge_score import (
    RagasROUGEScoreEntry,
    RagasROUGEScoreEvaluator,
    RagasROUGEScoreSettings,
)
from langevals_ragas.rubrics_based_scoring import (
    RagasRubricsBasedScoringEntry,
    RagasRubricsBasedScoringEvaluator,
    RagasRubricsBasedScoringRubric,
    RagasRubricsBasedScoringSettings,
)
from langevals_ragas.sql_query_equivalence import (
    RagasSQLQueryEquivalenceEntry,
    RagasSQLQueryEquivalenceEvaluator,
)
from langevals_ragas.summarization_score import (
    RagasSummarizationScoreEntry,
    RagasSummarizationScoreEvaluator,
)

dotenv.load_dotenv()
import pytest
from langevals_ragas.context_precision import (
    RagasContextPrecisionEntry,
    RagasContextPrecisionEvaluator,
    RagasContextPrecisionSettings,
)
from langevals_ragas.context_recall import (
    RagasContextRecallEntry,
    RagasContextRecallEvaluator,
    RagasContextRecallSettings,
)
from langevals_ragas.faithfulness import (
    RagasFaithfulnessEntry,
    RagasFaithfulnessEvaluator,
    RagasFaithfulnessSettings,
)
from langevals_ragas.factual_correctness import (
    RagasFactualCorrectnessEntry,
    RagasFactualCorrectnessEvaluator,
    RagasFactualCorrectnessSettings,
)

from langevals_ragas.lib.common import RagasSettings
from langevals_ragas.response_relevancy import (
    RagasResponseRelevancyEntry,
    RagasResponseRelevancyEvaluator,
    RagasResponseRelevancySettings,
)


def test_faithfulness():
    evaluator = RagasFaithfulnessEvaluator(settings=RagasFaithfulnessSettings())

    result = evaluator.evaluate(
        RagasFaithfulnessEntry(
            output="The capital of France is Paris.",
            contexts=[
                "France is a country in Europe.",
                "Paris is a city in France.",
                "Paris is the capital of France.",
            ],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_faithfulness_should_be_skipped_if_dont_know():
    evaluator = RagasFaithfulnessEvaluator(
        settings=RagasFaithfulnessSettings(autodetect_dont_know=True)
    )

    result = evaluator.evaluate(
        RagasFaithfulnessEntry(
            output="I couldn't find any information on changing your account email. Can I help you with anything else today?",
            contexts=["Our company XPTO was founded in 2024."],
        )
    )

    assert (
        result.details
        == "The output seems correctly to be an 'I don't know' statement given the provided contexts. Skipping faithfulness score."
    )
    assert result.status == "skipped"


class _StatementGeneratorOutputLike:
    """Mirrors ragas>=0.3 ragas.metrics._faithfulness.StatementGeneratorOutput:
    a flat ``statements: list[str]`` (the old SentencesSimplified had
    ``sentences[].simpler_statements`` instead)."""

    def __init__(self, statements):
        self.statements = statements


class _VerdictLike:
    def __init__(self, statement, reason, verdict):
        self.statement = statement
        self.reason = reason
        self.verdict = verdict


class _NLIStatementOutputLike:
    def __init__(self, statements):
        self.statements = statements


class _DummyLangchainLLM:
    model_name = "gpt-4o-mini"


class _DummyLLM:
    """Minimal stand-in for the LangchainLLMWrapper; only ``langchain_llm.model_name``
    is touched (by capture_cost's teardown) on this code path."""

    langchain_llm = _DummyLangchainLLM()


class _FakeFaithfulness:
    """Stands in for ragas.metrics.Faithfulness so the evaluator's monkey-patch
    of ``_create_statements`` / ``_create_verdicts`` runs against the ragas>=0.3
    output shape without any network/LLM call."""

    def __init__(self):
        self.llm = None

    async def _create_statements(self, row, callbacks):
        return _StatementGeneratorOutputLike(
            ["The capital of France is Paris.", "Paris is located in France."]
        )

    async def _create_verdicts(self, row, statements, callbacks):
        return _NLIStatementOutputLike(
            [_VerdictLike("The capital of France is Paris.", "supported by context", 1)]
        )

    def single_turn_score(self, sample):
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(self._create_statements({}, None))
            loop.run_until_complete(
                self._create_verdicts({}, ["The capital of France is Paris."], None)
            )
        finally:
            loop.close()
        return 0.5


def test_faithfulness_supports_ragas_0_3_statement_generator_output():
    """Regression: ragas>=0.3 ``_create_statements`` returns
    ``StatementGeneratorOutput`` (flat ``.statements``), not the old
    ``SentencesSimplified`` (``.sentences[].simpler_statements``). Before the fix
    this path raised ``'StatementGeneratorOutput' object has no attribute
    'sentences'`` and the request failed (surfaced as 502/524 after SDK retries)."""
    with patch(
        "langevals_ragas.faithfulness.Faithfulness", _FakeFaithfulness
    ), patch(
        "langevals_ragas.faithfulness.prepare_llm", return_value=(_DummyLLM(), None)
    ), patch(
        "langevals_ragas.faithfulness.check_max_tokens", return_value=None
    ):
        evaluator = RagasFaithfulnessEvaluator(
            settings=RagasFaithfulnessSettings(autodetect_dont_know=False)
        )
        result = evaluator.evaluate(
            RagasFaithfulnessEntry(
                output="The capital of France is Paris.",
                contexts=["Paris is the capital of France."],
            )
        )

    assert result.status == "processed"
    assert result.score == 0.5
    assert result.details and 'The capital of France is Paris.' in result.details


def test_cost_is_reported_as_unknown_when_model_is_not_priced():
    """When litellm cannot price the judge model (it raises "This model isn't
    mapped yet"), the cost is genuinely unknown and must be reported as ``None``
    — not a misleading ``$0``, which silently understates evaluation spend in
    cost dashboards. Regression for ``capture_cost`` swallowing the
    unmapped-model case in ``langevals_ragas/lib/common.py``."""
    with patch(
        "langevals_ragas.faithfulness.Faithfulness", _FakeFaithfulness
    ), patch(
        "langevals_ragas.faithfulness.prepare_llm", return_value=(_DummyLLM(), None)
    ), patch(
        "langevals_ragas.faithfulness.check_max_tokens", return_value=None
    ), patch(
        "langevals_ragas.lib.common.cost_per_token",
        side_effect=Exception("This model isn't mapped yet."),
    ):
        evaluator = RagasFaithfulnessEvaluator(
            settings=RagasFaithfulnessSettings(autodetect_dont_know=False)
        )
        result = evaluator.evaluate(
            RagasFaithfulnessEntry(
                output="The capital of France is Paris.",
                contexts=["Paris is the capital of France."],
            )
        )

    assert result.status == "processed"
    assert result.cost is None


def test_cost_is_reported_as_money_when_model_is_priced():
    """When litellm can price the model, the cost must be reported as a ``Money``
    (even ``$0`` for a zero-token run) — never ``None``. Guards the
    ``capture_cost`` success path against the unmapped-model fix."""
    with patch(
        "langevals_ragas.faithfulness.Faithfulness", _FakeFaithfulness
    ), patch(
        "langevals_ragas.faithfulness.prepare_llm", return_value=(_DummyLLM(), None)
    ), patch(
        "langevals_ragas.faithfulness.check_max_tokens", return_value=None
    ), patch(
        "langevals_ragas.lib.common.cost_per_token",
        return_value=(0.001, 0.002),
    ):
        evaluator = RagasFaithfulnessEvaluator(
            settings=RagasFaithfulnessSettings(autodetect_dont_know=False)
        )
        result = evaluator.evaluate(
            RagasFaithfulnessEntry(
                output="The capital of France is Paris.",
                contexts=["Paris is the capital of France."],
            )
        )

    assert result.status == "processed"
    assert isinstance(result.cost, Money)
    assert result.cost.amount == pytest.approx(0.003)


def test_response_relevancy():
    evaluator = RagasResponseRelevancyEvaluator(
        settings=RagasResponseRelevancySettings()
    )

    result = evaluator.evaluate(
        RagasResponseRelevancyEntry(
            input="What is the capital of France?",
            output="The capital of France is Paris.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    assert result.cost and result.cost.amount > 0.0
    assert result.details


@pytest.mark.skipif(
    not (
        os.environ.get("AZURE_OPENAI_API_KEY")
        and os.environ.get("AZURE_OPENAI_ENDPOINT")
        and os.environ.get("AZURE_DEPLOYMENT_NAME")
        and os.environ.get("AZURE_EMBEDDINGS_DEPLOYMENT_NAME")
    ),
    reason="Azure OpenAI credentials or deployment names not set",
)
def test_response_relevancy_with_azure_embeddings():
    evaluator = RagasResponseRelevancyEvaluator(
        settings=RagasResponseRelevancySettings(
            model="azure/gpt-4o-mini",
            embeddings_model="azure/text-embedding-ada-002",
        )
    )

    result = evaluator.evaluate(
        RagasResponseRelevancyEntry(
            input="What is the capital of France?",
            output="The capital of France is Paris.",
        )
    )

    assert result.status == "processed"
    assert result.score is not None


def test_factual_correctness():
    evaluator = RagasFactualCorrectnessEvaluator(
        settings=RagasFactualCorrectnessSettings()
    )

    result = evaluator.evaluate(
        RagasFactualCorrectnessEntry(
            output="The capital of France is Paris.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.5
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_factual_correctness_fail():
    evaluator = RagasFactualCorrectnessEvaluator(
        settings=RagasFactualCorrectnessSettings()
    )

    result = evaluator.evaluate(
        RagasFactualCorrectnessEntry(
            output="The capital of France is Grenoble.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score is not None and result.score < 0.5
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_context_precision():
    evaluator = RagasContextPrecisionEvaluator(settings=RagasContextPrecisionSettings())

    result = evaluator.evaluate(
        RagasContextPrecisionEntry(
            contexts=["The Eiffel Tower is located in Paris."],
            expected_contexts=[
                "Paris is the capital of France.",
                "The Eiffel Tower is one of the most famous landmarks in Paris.",
            ],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.99
    assert not result.cost


def test_context_precision_with_empty_contexts():
    evaluator = RagasContextPrecisionEvaluator(settings=RagasContextPrecisionSettings())

    result = evaluator.evaluate(
        RagasContextPrecisionEntry(
            contexts=[],
            expected_contexts=[],
        )
    )
    assert result.status == "processed"
    assert result.score is not None and result.score == 1.0
    assert not result.cost

    result = evaluator.evaluate(
        RagasContextPrecisionEntry(
            contexts=[],
            expected_contexts=[
                "Paris is the capital of France.",
                "The Eiffel Tower is one of the most famous landmarks in Paris.",
            ],
        )
    )
    assert result.status == "processed"
    assert result.score is not None and result.score == 0.0
    assert not result.cost

    result = evaluator.evaluate(
        RagasContextPrecisionEntry(
            contexts=["The Eiffel Tower is located in Paris."],
            expected_contexts=[],
        )
    )

    assert result.status == "processed"
    assert result.score is not None and result.score == 0.0
    assert not result.cost


def test_context_recall():
    evaluator = RagasContextRecallEvaluator(settings=RagasContextRecallSettings())

    result = evaluator.evaluate(
        RagasContextRecallEntry(
            contexts=["The Eiffel Tower is located in Paris."],
            expected_contexts=[
                "Paris is the capital of France.",
                "The Eiffel Tower is one of the most famous landmarks in Paris.",
            ],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score >= 0.5
    assert not result.cost


def test_context_recall_with_empty_contexts():
    evaluator = RagasContextRecallEvaluator(settings=RagasContextRecallSettings())

    result = evaluator.evaluate(
        RagasContextRecallEntry(
            contexts=[],
            expected_contexts=[],
        )
    )

    assert result.status == "processed"
    assert result.score is not None and result.score == 1.0
    assert not result.cost

    result = evaluator.evaluate(
        RagasContextRecallEntry(
            contexts=[],
            expected_contexts=[
                "Paris is the capital of France.",
                "The Eiffel Tower is one of the most famous landmarks in Paris.",
            ],
        )
    )

    assert result.status == "processed"
    assert result.score is not None and result.score == 0.0
    assert not result.cost

    result = evaluator.evaluate(
        RagasContextRecallEntry(
            contexts=["The Eiffel Tower is located in Paris."],
            expected_contexts=[],
        )
    )

    assert result.status == "processed"
    assert result.score is not None and result.score == 1.0
    assert not result.cost


def test_context_f1():
    evaluator = RagasContextF1Evaluator(settings=RagasContextF1Settings())

    result = evaluator.evaluate(
        RagasContextF1Entry(
            contexts=["The Eiffel Tower is located in Paris."],
            expected_contexts=[
                "Paris is the capital of France.",
                "The Eiffel Tower is one of the most famous landmarks in Paris.",
            ],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.5
    assert not result.cost
    assert result.details


def test_context_f1_with_empty_contexts():
    evaluator = RagasContextF1Evaluator(settings=RagasContextF1Settings())

    result = evaluator.evaluate(RagasContextF1Entry(contexts=[], expected_contexts=[]))

    assert result.status == "processed"
    assert result.score is not None and result.score == 1.0
    assert not result.cost

    result = evaluator.evaluate(
        RagasContextF1Entry(contexts=[], expected_contexts=["context"])
    )

    assert result.status == "processed"
    assert result.score is not None and result.score == 0.0
    assert not result.cost

    result = evaluator.evaluate(
        RagasContextF1Entry(contexts=["context"], expected_contexts=[])
    )

    assert result.status == "processed"
    assert result.score is not None and result.score == 0.0
    assert not result.cost


def test_response_context_precision_with_reference():
    evaluator = RagasResponseContextPrecisionEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasResponseContextPrecisionEntry(
            input="What is the capital of France?",
            contexts=["France is a country in Europe.", "Paris is a city in France."],
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score is not None
    assert result.cost and result.cost.amount > 0.0


def test_response_context_precision_without_reference():
    evaluator = RagasResponseContextPrecisionEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasResponseContextPrecisionEntry(
            input="What is the capital of France?",
            output="Paris is the capital of France.",
            contexts=["France is a country in Europe.", "Paris is a city in France."],
        )
    )

    assert result.status == "processed"
    assert result.score is not None
    assert result.cost and result.cost.amount > 0.0


def test_response_context_recall():
    evaluator = RagasResponseContextRecallEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasResponseContextRecallEntry(
            input="Where is the Eiffel Tower located?",
            output="The Eiffel Tower is located in Paris.",
            expected_output="The Eiffel Tower is located in Paris.",
            contexts=["Paris is the capital of France."],
        )
    )

    assert result.status == "processed"
    assert result.score is not None
    assert result.cost and result.cost.amount > 0.0


@pytest.mark.skipif(not os.environ.get("ANTHROPIC_API_KEY"), reason="ANTHROPIC_API_KEY not set")
def test_with_anthropic_models():
    evaluator = RagasResponseRelevancyEvaluator(
        settings=RagasResponseRelevancySettings(
            model="anthropic/claude-3-5-sonnet-20240620"
        )
    )

    result = evaluator.evaluate(
        RagasResponseRelevancyEntry(
            input="What is the capital of France?",
            output="The capital of France is Paris.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    assert result.cost and result.cost.amount > 0.0


def test_sql_query_equivalence():
    evaluator = RagasSQLQueryEquivalenceEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasSQLQueryEquivalenceEntry(
            output="SELECT id, name FROM users WHERE active = 1;",
            expected_output="SELECT id, name FROM users WHERE active = true;",
            expected_contexts=[
                """
                    Table users:
                    - id: INT
                    - name: VARCHAR
                    - active: BOOLEAN
                """
            ],
        )
    )

    assert result.status == "processed"
    assert result.passed
    assert result.cost and result.cost.amount > 0.0
    assert result.details


# Skipped due to LLM-judged non-determinism — see langwatch/langwatch#3240.
@pytest.mark.skip(reason="flaky LLM eval score; tracked in #3240")
def test_summarization_score():
    evaluator = RagasSummarizationScoreEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasSummarizationScoreEntry(
            output="A company is launching a fitness tracking app that helps users set exercise goals, log meals, and track water intake, with personalized workout suggestions and motivational reminders.",
            contexts=[
                "A company is launching a new product, a smartphone app designed to help users track their fitness goals. The app allows users to set daily exercise targets, log their meals, and track their water intake. It also provides personalized workout recommendations and sends motivational reminders throughout the day."
            ],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.4
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_rubrics_based_scoring_with_reference():
    evaluator = RagasRubricsBasedScoringEvaluator(
        settings=RagasRubricsBasedScoringSettings()
    )

    result = evaluator.evaluate(
        RagasRubricsBasedScoringEntry(
            input="What is the capital of France?",
            output="Paris is the capital of France.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score == 5
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_rubrics_based_scoring_without_reference():
    evaluator = RagasRubricsBasedScoringEvaluator(
        settings=RagasRubricsBasedScoringSettings()
    )

    result = evaluator.evaluate(
        RagasRubricsBasedScoringEntry(
            input="What is the capital of France?",
            output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score == 5
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_rubrics_based_scoring_with_custom_rubrics():
    evaluator = RagasRubricsBasedScoringEvaluator(
        settings=RagasRubricsBasedScoringSettings(
            rubrics=[
                RagasRubricsBasedScoringRubric(
                    description="The response is incorrect, irrelevant."
                ),
                RagasRubricsBasedScoringRubric(
                    description="The response fully answers the question and includes no errors, omissions, or irrelevant information."
                ),
            ]
        )
    )

    result = evaluator.evaluate(
        RagasRubricsBasedScoringEntry(
            input="What is the capital of France?",
            output="Paris is the capital of France.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score == 2
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_bleu_score():
    evaluator = RagasBLEUScoreEvaluator(settings=EvaluatorSettings())

    result = evaluator.evaluate(
        RagasBLEUScoreEntry(
            output="Paris is the capital of France.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score >= 1.0


def test_rouge_score():
    evaluator = RagasROUGEScoreEvaluator(settings=RagasROUGEScoreSettings())

    result = evaluator.evaluate(
        RagasROUGEScoreEntry(
            output="Paris is the capital of France.",
            expected_output="Paris is the capital of France, Europe.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
