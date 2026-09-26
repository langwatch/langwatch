"""The llm_boolean judge returns what the instructions ask for, never a flipped "passed".

Provider stubbed at `litellm_patch.originals`, no keys or network.
Spec: specs/evaluators/langevals-judge-reasoning-tool-compatibility.feature
"""

import json

import pytest
from litellm.files.main import ModelResponse

from langevals_core import litellm_patch
from langevals_core.litellm_patch import patch_litellm
from langevals_langevals.llm_boolean import (
    EVALUATION_TOOL,
    RESULT_FRAMING,
    CustomLLMBooleanEntry,
    CustomLLMBooleanEvaluator,
    CustomLLMBooleanSettings,
)

FAIL_CONDITION_PROMPT = "Return false if the answer mentions a competitor (Globex)."


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
    state: dict = {"requests": [], "answer": {"reasoning": "r", "result": True}}

    def provider(*args, **kwargs):
        state["requests"].append(kwargs)
        return verdict_response(state["answer"])

    monkeypatch.setitem(litellm_patch.originals, "completion", provider)
    return state


def run(prompt: str = FAIL_CONDITION_PROMPT):
    evaluator = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(model="openai/gpt-5-mini", prompt=prompt)
    )
    return evaluator.evaluate(
        CustomLLMBooleanEntry(input="Which vendor?", output="Try Globex.")
    )


# @scenario "The boolean judge is told its result is exactly what the instructions ask for"
def test_framing_states_the_result_is_the_value_the_instructions_ask_for():
    assert "exactly the true or false value the instructions above ask you to return" in RESULT_FRAMING
    assert "If they say when to return false, return false in that case and true in every other case" in RESULT_FRAMING
    assert "If they say when to return true, return true in that case and false in every other case" in RESULT_FRAMING
    assert "never invert it" in RESULT_FRAMING

    parameters = EVALUATION_TOOL["function"]["parameters"]
    assert "passed" not in parameters["properties"]
    assert parameters["required"] == ["reasoning", "result"]
    result_description = parameters["properties"]["result"]["description"]
    assert "Exactly the value the instructions ask you to return" in result_description
    assert "Not a judgment of whether the content is good" in result_description
    assert "instructions ask for" in EVALUATION_TOOL["function"]["description"]


# @scenario "The boolean judge is told its result is exactly what the instructions ask for"
def test_judge_receives_the_customer_prompt_then_the_framing(judge):
    run()

    request = judge["requests"][-1]
    system = request["messages"][0]
    assert system["role"] == "system"
    assert system["content"] == f"{FAIL_CONDITION_PROMPT}\n\n{RESULT_FRAMING}"
    assert request["tools"] == [EVALUATION_TOOL]
    assert request["tool_choice"] == {"type": "function", "function": {"name": "evaluation"}}


# @scenario "A fail-condition prompt yields false when its condition holds and true when it does not"
@pytest.mark.parametrize("result, score", [(False, 0), (True, 1)])
def test_result_maps_onto_passed_unchanged(judge, result, score):
    judge["answer"] = {"reasoning": "because", "result": result}

    evaluation = run()

    assert evaluation.status == "processed"
    assert evaluation.passed is result
    assert evaluation.score == score
    assert evaluation.details == "because"


# @scenario "A judge that never calls its function fails with a clear error"
def test_result_that_is_not_a_boolean_is_an_error_not_a_verdict(judge):
    judge["answer"] = {"reasoning": "because", "result": "maybe"}

    with pytest.raises(Exception) as raised:
        run()

    assert "neither true nor false" in str(raised.value)
