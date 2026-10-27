"""The LLM-as-judge tools ask for a justification from the evidence, never for
the model's reasoning, and keep the result schema their callers read.
Provider stubbed, no keys or network.

Spec: specs/evaluators/langevals-judge-justification-wording.feature
"""

import json
import re

import pytest
from litellm.files.main import ModelResponse

from langevals_core import litellm_patch
from langevals_core.litellm_patch import patch_litellm
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

MODEL = "anthropic/claude-sonnet-4-6"

# Wording that asks a model to write out its own reasoning or thoughts.
REASONING_EXTRACTION = re.compile(r"\breason|\bthought|\bponder|step by step", re.IGNORECASE)


def verdict_response(arguments: dict) -> ModelResponse:
    return ModelResponse(
        model=MODEL,
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
    answer = {
        "reasoning": "get_quote returned 1387.50; the reply says 1387.50.",
        "result": True,
        "final_score": 8,
        "label": "refund",
    }

    def provider(*args, **kwargs):
        requests.append(kwargs)
        return verdict_response(answer)

    monkeypatch.setitem(litellm_patch.originals, "completion", provider)
    return requests


def run_boolean():
    return CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(model=MODEL, prompt="Return false if the total is wrong.")
    ).evaluate(CustomLLMBooleanEntry(input="How much?", output="1387.50"))


def run_score():
    return CustomLLMScoreEvaluator(
        settings=CustomLLMScoreSettings(model=MODEL, prompt="Score the reply from 0 to 10.")
    ).evaluate(CustomLLMScoreEntry(input="How much?", output="1387.50"))


def run_category():
    return CustomLLMCategoryEvaluator(
        settings=CustomLLMCategorySettings(
            model=MODEL,
            prompt="Categorise the conversation.",
            categories=[
                CustomLLMCategoryDefinition(name="refund", description="Refunds"),
                CustomLLMCategoryDefinition(name="other", description="Anything else"),
            ],
        )
    ).evaluate(CustomLLMCategoryEntry(input="How much?", output="1387.50"))


def descriptions(tool: dict) -> list[str]:
    function = tool["function"]
    texts = [function.get("description", "")]
    for name, prop in function["parameters"]["properties"].items():
        texts.append(prop.get("description", ""))
    return texts


# @scenario "A judge tool asks for a justification, not for the model's reasoning"
@pytest.mark.parametrize("run", [run_boolean, run_score, run_category])
def test_a_judge_tool_asks_for_a_justification(judge, run):
    run()

    tool = judge[0]["tools"][0]
    texts = descriptions(tool)
    assert all(not REASONING_EXTRACTION.search(text) for text in texts), texts
    assert any("justification" in text for text in texts)


# @scenario "The judge's answer keeps the schema its callers read"
@pytest.mark.parametrize("run", [run_boolean, run_score, run_category])
def test_the_answer_keeps_its_schema(judge, run):
    result = run()

    tool = judge[0]["tools"][0]
    assert "reasoning" in tool["function"]["parameters"]["required"]
    assert result.status == "processed"
    assert result.details == "get_quote returned 1387.50; the reply says 1387.50."
