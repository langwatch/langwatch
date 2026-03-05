import os
import dotenv
import pytest

from langevals_core.base_evaluator import EvaluatorSettings
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
