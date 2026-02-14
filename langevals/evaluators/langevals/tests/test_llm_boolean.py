import os
import dotenv

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
        model="openai/gpt-5",
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
        model="openai/gpt-5",
        prompt="You are an LLM evaluator. We need the guarantee that the output is using the provided context and not it's own brain, please evaluate as False if is not.",
        max_tokens=2048,
    )

    evaluator = CustomLLMBooleanEvaluator(settings=settings)

    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert result.details
    assert "Total tokens exceed the maximum of 2048" in result.details


def test_groq_models():
    entry = CustomLLMBooleanEntry(
        input="What is the capital of France?",
        output="The capital of France is Paris.",
        contexts=["London is the capital of France."],
    )
    settings = CustomLLMBooleanSettings(
        model="groq/llama3-70b-8192",
        prompt="You are an LLM evaluator. We need the guarantee that the output is using the provided context and not it's own brain, please evaluate as False if is not.",
    )

    evaluator = CustomLLMBooleanEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score == 0
    assert result.passed == False
    assert result.cost
    assert result.cost.amount > 0


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
