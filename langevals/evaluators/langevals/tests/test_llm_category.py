import os
import dotenv

dotenv.load_dotenv()

from langevals_langevals.llm_category import (
    CustomLLMCategoryDefinition,
    CustomLLMCategoryEvaluator,
    CustomLLMCategoryEntry,
    CustomLLMCategorySettings,
)


def test_custom_llm_category_evaluator():
    entry = CustomLLMCategoryEntry(
        input="What is the capital of France?",
        output="The capital of France is Paris.",
        contexts=["London is the capital of France."],
    )
    settings = CustomLLMCategorySettings(
        model="openai/gpt-5",
        prompt="You are an LLM category evaluator. Please categorize the answer in one of the following categories",
        categories=[
            CustomLLMCategoryDefinition(
                name="relevant",
                description="The answer is relevant to the question",
            ),
            CustomLLMCategoryDefinition(
                name="irrelevant",
                description="The answer is not relevant to the question",
            ),
        ],
    )

    evaluator = CustomLLMCategoryEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.label == "relevant"
    assert result.cost
    assert result.cost.amount > 0


def test_custom_llm_category_evaluator_skips_if_context_is_too_large():
    entry = CustomLLMCategoryEntry(
        input="What is the capital of France?",
        output="The capital of France is Paris.",
        contexts=["London is the capital of France."] * 300,
    )
    settings = CustomLLMCategorySettings(
        model="openai/gpt-5",
        prompt="You are an LLM category evaluator. Please categorize the answer in one of the following categories",
        categories=[
            CustomLLMCategoryDefinition(
                name="relevant",
                description="The answer is relevant to the question",
            ),
            CustomLLMCategoryDefinition(
                name="irrelevant",
                description="The answer is not relevant to the question",
            ),
        ],
        max_tokens=2048,
    )

    evaluator = CustomLLMCategoryEvaluator(settings=settings)

    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert result.details
    assert "Total tokens exceed the maximum of 2048" in result.details


def test_llm_as_judge_atla_ai():
    vegetarian_checker = CustomLLMCategoryEvaluator(
        settings=CustomLLMCategorySettings(
            model="openai/atla-selene",
            prompt="Is the recipe vegetarian?",
            categories=[
                CustomLLMCategoryDefinition(
                    name="vegetarian",
                    description="The recipe is vegetarian",
                ),
                CustomLLMCategoryDefinition(
                    name="non-vegetarian",
                    description="The recipe is not vegetarian",
                ),
            ],
        ),
        env={
            "X_LITELLM_api_key": os.getenv("ATLA_API_KEY", ""),
            "X_LITELLM_api_base": "https://api.atla-ai.com/v1",
        },
    )

    result = vegetarian_checker.evaluate(
        CustomLLMCategoryEntry(input="Vegetables", output="Broccoli")
    )

    assert result.status == "processed"
    assert result.label == "vegetarian"
