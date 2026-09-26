import os
import dotenv
import pytest

dotenv.load_dotenv()

from langevals_langevals.llm_boolean import (
    CustomLLMBooleanEvaluator,
    CustomLLMBooleanEntry,
    CustomLLMBooleanSettings,
)


def test_custom_llm_boolean_evaluator():
    entry = CustomLLMBooleanEntry(
        input="What is the capital of France?",
        output="The capital of France is Paris.",
        contexts=["London is the capital of France."],
    )
    settings = CustomLLMBooleanSettings(
        model="openai/gpt-5-mini",
        prompt="You are an LLM evaluator. We need the guarantee that the output is using the provided context and not it's own brain, please evaluate as False if is not.",
    )

    evaluator = CustomLLMBooleanEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 0
    assert result.passed == False
    assert result.cost
    assert result.cost.amount > 0


def test_custom_llm_boolean_evaluator_skips_if_context_is_too_large():
    entry = CustomLLMBooleanEntry(
        input="What is the capital of France?",
        output="The capital of France is Paris.",
        contexts=["London is the capital of France."] * 300,
    )
    settings = CustomLLMBooleanSettings(
        model="openai/gpt-5-mini",
        prompt="You are an LLM evaluator. We need the guarantee that the output is using the provided context and not it's own brain, please evaluate as False if is not.",
        max_tokens=2048,
    )

    evaluator = CustomLLMBooleanEvaluator(settings=settings)

    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert result.details
    assert "Total tokens exceed the maximum of 2048" in result.details


@pytest.mark.skipif(not os.environ.get("ATLA_API_KEY"), reason="ATLA_API_KEY not set")
def test_llm_as_judge_atla_ai():
    vegetarian_checker = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(
            model="openai/atla-selene",
            prompt="Is the recipe vegetarian?",
        ),
        env={
            "X_LITELLM_api_key": os.getenv("ATLA_API_KEY", ""),
            "X_LITELLM_api_base": "https://api.atla-ai.com/v1",
        },
    )

    result = vegetarian_checker.evaluate(
        CustomLLMBooleanEntry(input="Vegetables", output="Broccoli")
    )

    assert result.status == "processed"
    assert result.score == 1
    assert result.passed == True


# Real calls, one per outcome, on the fail-condition wording most customer
# prompts use. Skipped without keys; LANGEVALS_POLARITY_MODELS widens the list.
POLARITY_MODELS = os.environ.get(
    "LANGEVALS_POLARITY_MODELS", "openai/gpt-5-mini"
).split(",")

COMPETITOR_PROMPT = (
    "You are checking a support agent for Acme. Return false if the answer "
    "mentions a competitor of Acme (Globex or Initech)."
)


def _key_for(model: str) -> bool:
    provider = model.split("/")[0]
    if provider == "bedrock":
        return bool(os.environ.get("AWS_ACCESS_KEY_ID"))
    return bool(os.environ.get(f"{provider.upper()}_API_KEY"))


# @scenario "A fail-condition prompt yields false when its condition holds and true when it does not"
@pytest.mark.parametrize("model", POLARITY_MODELS)
@pytest.mark.parametrize(
    "output, expected",
    [
        ("You could also try Globex, their plan is cheaper.", False),
        ("Acme's Pro plan includes priority support and SSO.", True),
    ],
)
def test_fail_condition_prompt_keeps_its_polarity(model, output, expected):
    if not _key_for(model):
        pytest.skip(f"no API key for {model}")

    evaluator = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(model=model, prompt=COMPETITOR_PROMPT)
    )
    result = evaluator.evaluate(
        CustomLLMBooleanEntry(input="Which plan should I pick?", output=output)
    )

    assert result.status == "processed", result.details
    assert result.passed is expected
