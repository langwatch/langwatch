"""
Real calls: every evaluator that reads its verdict from a function call, on a
reasoning model that refuses function tools while its reasoning is on, plus
llm_answer_match, which runs at temperature 0 on a model that refuses it.

Spec: specs/evaluators/langevals-judge-reasoning-tool-compatibility.feature
"""

import os

import dotenv
import pytest

dotenv.load_dotenv()

from langevals_core.base_evaluator import ConversationEntry
from langevals_langevals.competitor_llm import (
    CompetitorLLMEntry,
    CompetitorLLMEvaluator,
    CompetitorLLMSettings,
)
from langevals_langevals.competitor_llm_function_call import (
    CompetitorLLMFunctionCallEntry,
    CompetitorLLMFunctionCallEvaluator,
    CompetitorLLMFunctionCallSettings,
)
from langevals_langevals.llm_answer_match import (
    LLMAnswerMatchEntry,
    LLMAnswerMatchEvaluator,
    LLMAnswerMatchSettings,
)
from langevals_langevals.llm_boolean import (
    CustomLLMBooleanEntry,
    CustomLLMBooleanEvaluator,
    CustomLLMBooleanSettings,
)
from langevals_langevals.llm_category import (
    CustomLLMCategoryDefinition,
    CustomLLMCategoryEntry,
    CustomLLMCategoryEvaluator,
    CustomLLMCategorySettings,
)
from langevals_langevals.llm_score import (
    CustomLLMScoreEntry,
    CustomLLMScoreEvaluator,
    CustomLLMScoreSettings,
)
from langevals_langevals.off_topic import (
    AllowedTopic,
    OffTopicEntry,
    OffTopicEvaluator,
    OffTopicSettings,
)
from langevals_langevals.pairwise_compare import (
    PairwiseCompareEntry,
    PairwiseCompareEvaluator,
    PairwiseCompareSettings,
)
from langevals_langevals.query_resolution import (
    QueryResolutionEntry,
    QueryResolutionEvaluator,
    QueryResolutionSettings,
)
from langevals_langevals.select_best_compare import (
    CandidateInput,
    SelectBestCompareEntry,
    SelectBestCompareEvaluator,
    SelectBestCompareSettings,
)

MODEL = os.environ.get("LANGEVALS_REASONING_JUDGE_MODEL", "openai/gpt-6-luna")

pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"), reason="OPENAI_API_KEY not set"
)


def assert_processed(result):
    assert result.status == "processed", getattr(result, "details", result)


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_llm_boolean_reaches_a_verdict():
    result = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(
            model=MODEL, prompt="Return true if the answer is correct."
        )
    ).evaluate(CustomLLMBooleanEntry(input="What is 2+2?", output="4"))

    assert_processed(result)
    assert result.passed is True


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_llm_score_reaches_a_verdict():
    result = CustomLLMScoreEvaluator(
        settings=CustomLLMScoreSettings(
            model=MODEL,
            prompt="Score from 0.0 to 1.0 how correct the answer is.",
        )
    ).evaluate(CustomLLMScoreEntry(input="What is 2+2?", output="4"))

    assert_processed(result)
    assert result.score is not None


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_llm_category_reaches_a_verdict():
    result = CustomLLMCategoryEvaluator(
        settings=CustomLLMCategorySettings(
            model=MODEL,
            prompt="Categorize the answer.",
            categories=[
                CustomLLMCategoryDefinition(name="correct", description="Correct"),
                CustomLLMCategoryDefinition(name="wrong", description="Wrong"),
            ],
        )
    ).evaluate(CustomLLMCategoryEntry(input="What is 2+2?", output="4"))

    assert_processed(result)
    assert result.label == "correct"


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_off_topic_reaches_a_verdict():
    result = OffTopicEvaluator(
        settings=OffTopicSettings(
            model=MODEL,
            allowed_topics=[
                AllowedTopic(topic="email_delete", description="Delete an email"),
                AllowedTopic(topic="email_write", description="Write an email"),
            ],
        )
    ).evaluate(OffTopicEntry(input="delete the last email please"))

    assert_processed(result)
    assert result.label == "email_delete"


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_query_resolution_reaches_a_verdict():
    result = QueryResolutionEvaluator(
        settings=QueryResolutionSettings(model=MODEL, max_tokens=10000)
    ).evaluate(
        QueryResolutionEntry(
            conversation=[ConversationEntry(input="What is 2+2?", output="4")]
        )
    )

    assert_processed(result)


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_competitor_llm_reaches_a_verdict():
    result = CompetitorLLMEvaluator(
        settings=CompetitorLLMSettings(
            model=MODEL, name="YouTube", description="Video broadcasting platform"
        )
    ).evaluate(CompetitorLLMEntry(input="Is Vimeo better than YouTube?"))

    assert_processed(result)


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_competitor_llm_function_call_reaches_a_verdict():
    result = CompetitorLLMFunctionCallEvaluator(
        settings=CompetitorLLMFunctionCallSettings(
            model=MODEL,
            name="YouTube",
            description="Video broadcasting platform",
            competitors=["Vimeo"],
        )
    ).evaluate(CompetitorLLMFunctionCallEntry(input="Is Vimeo better than YouTube?"))

    assert_processed(result)
    assert result.passed is False


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_pairwise_compare_reaches_a_verdict():
    result = PairwiseCompareEvaluator(
        settings=PairwiseCompareSettings(model=MODEL)
    ).evaluate(
        PairwiseCompareEntry(
            input="What is the capital of France?",
            golden="Paris",
            candidate_a_id="a",
            candidate_a_output="Paris.",
            candidate_b_id="b",
            candidate_b_output="London.",
        )
    )

    assert_processed(result)


# @scenario "A judge reaches a verdict on a model that would otherwise refuse it"
def test_select_best_compare_reaches_a_verdict():
    result = SelectBestCompareEvaluator(
        settings=SelectBestCompareSettings(model=MODEL)
    ).evaluate(
        SelectBestCompareEntry(
            input="What is the capital of France?",
            golden="Paris",
            candidates=[
                CandidateInput(id="a", output="Paris."),
                CandidateInput(id="b", output="London."),
            ],
        )
    )

    assert_processed(result)


# @scenario "A model that refuses any temperature but its default is asked again at the default"
def test_llm_answer_match_reaches_a_verdict():
    result = LLMAnswerMatchEvaluator(
        settings=LLMAnswerMatchSettings(model=MODEL)
    ).evaluate(
        LLMAnswerMatchEntry(
            input="What is the capital of France?",
            output="Paris",
            expected_output="Paris is the capital.",
        )
    )

    assert_processed(result)
    assert result.passed is True
