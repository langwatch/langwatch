"""LLM-as-judge evaluators judge content over their token budget with its
middle cut, instead of skipping it. Provider stubbed, no keys or network.

Spec: specs/evaluators/langevals-judge-long-content.feature
"""

import json

import pytest
from litellm.files.main import ModelResponse

from langevals_core import litellm_patch
from langevals_core.litellm_patch import patch_litellm
from langevals_core.token_budget import count_tokens
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

MODEL = "openai/gpt-5-mini"
BUDGET = 3000
OPENING = "OPENING: the user asks for a refund on order 1234."
ENDING = "ENDING: the agent confirms the refund was issued."
LONG_OUTPUT = (
    OPENING
    + "\n"
    + "\n".join(f"turn {i}: the agent looks up the order again." for i in range(4000))
    + "\n"
    + ENDING
)


def verdict_response(arguments: dict) -> ModelResponse:
    return ModelResponse(
        model="gpt-5-mini",
        choices=[
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "evaluation", "arguments": json.dumps(arguments)},
                        }
                    ],
                },
            }
        ],
        usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    )


@pytest.fixture
def judge(monkeypatch):
    patch_litellm()
    requests: list[dict] = []
    answer = {"reasoning": "r", "result": True, "final_score": 0.8, "label": "refund"}

    def provider(*args, **kwargs):
        requests.append(kwargs)
        return verdict_response(answer)

    monkeypatch.setitem(litellm_patch.originals, "completion", provider)
    return requests


def run_boolean(output: str, prompt: str = "Return false if the refund was never confirmed."):
    evaluator = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(model=MODEL, prompt=prompt, max_tokens=BUDGET)
    )
    return evaluator.evaluate(CustomLLMBooleanEntry(input="Where is my refund?", output=output))


def run_score(output: str):
    evaluator = CustomLLMScoreEvaluator(
        settings=CustomLLMScoreSettings(model=MODEL, prompt="Score the reply.", max_tokens=BUDGET)
    )
    return evaluator.evaluate(CustomLLMScoreEntry(input="Where is my refund?", output=output))


def run_category(output: str):
    evaluator = CustomLLMCategoryEvaluator(
        settings=CustomLLMCategorySettings(
            model=MODEL,
            prompt="Categorise the conversation.",
            categories=[
                CustomLLMCategoryDefinition(name="refund", description="Refunds"),
                CustomLLMCategoryDefinition(name="other", description="Anything else"),
            ],
            max_tokens=BUDGET,
        )
    )
    return evaluator.evaluate(CustomLLMCategoryEntry(input="Where is my refund?", output=output))


def sent_tokens(request: dict) -> int:
    return sum(count_tokens(MODEL, message["content"]) for message in request["messages"])


# @scenario "Content over the budget is judged with its middle cut"
@pytest.mark.parametrize("run", [run_boolean, run_score, run_category])
def test_content_over_the_budget_is_judged_with_its_middle_cut(judge, run):
    result = run(LONG_OUTPUT)

    assert result.status == "processed"
    user_message = judge[0]["messages"][1]["content"]
    assert OPENING in user_message
    assert ENDING in user_message
    assert "tokens omitted from the middle to fit the length limit" in user_message
    assert "Where is my refund?" in user_message
    assert sent_tokens(judge[0]) <= BUDGET
    assert result.details is not None
    assert f"to fit the maximum of {BUDGET} tokens." in result.details


# @scenario "Content within the budget reaches the judge unchanged"
def test_content_within_the_budget_reaches_the_judge_unchanged(judge):
    result = run_boolean("The refund was issued yesterday.")

    assert result.status == "processed"
    assert judge[0]["messages"][1]["content"].startswith(
        "# Input\nWhere is my refund?\n\n# Output\nThe refund was issued yesterday.\n\n"
    )
    assert result.details == "r"


# @scenario "A prompt that leaves no room for content is skipped with the reason"
def test_prompt_that_fills_the_budget_is_skipped(judge):
    result = run_boolean("The refund was issued.", prompt="Judge carefully. " * 2000)

    assert result.status == "skipped"
    assert result.details is not None
    assert f"leaves no room for the content within the maximum of {BUDGET} tokens" in result.details
    assert judge == []
