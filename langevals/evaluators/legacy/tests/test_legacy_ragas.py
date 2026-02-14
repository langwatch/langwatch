import dotenv

dotenv.load_dotenv()
from langevals_legacy.ragas_context_precision import (
    RagasContextPrecisionEntry,
    RagasContextPrecisionEvaluator,
)
from langevals_legacy.ragas_context_recall import (
    RagasContextRecallEntry,
    RagasContextRecallEvaluator,
)
from langevals_legacy.ragas_context_relevancy import (
    RagasContextRelevancyEntry,
    RagasContextRelevancyEvaluator,
)
from langevals_legacy.ragas_context_utilization import (
    RagasContextUtilizationEntry,
    RagasContextUtilizationEvaluator,
)
from langevals_legacy.ragas_faithfulness import (
    RagasFaithfulnessEntry,
    RagasFaithfulnessEvaluator,
)
from langevals_legacy.ragas_answer_correctness import (
    RagasAnswerCorrectnessEntry,
    RagasAnswerCorrectnessEvaluator,
)

from langevals_legacy.ragas_lib.common import RagasSettings
from langevals_legacy.ragas_answer_relevancy import (
    RagasAnswerRelevancyEntry,
    RagasAnswerRelevancyEvaluator,
)


def test_faithfulness():
    evaluator = RagasFaithfulnessEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasFaithfulnessEntry(
            output="The capital of France is Paris.",
            contexts=["France is a country in Europe.", "Paris is a city in France."],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    assert result.cost and result.cost.amount > 0.0
    assert result.details


def test_faithfulness_should_be_skipped_if_no_sentences():
    evaluator = RagasFaithfulnessEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasFaithfulnessEntry(
            output="I couldn't find any information on completing your account. Can I help you with anything else today?",
            contexts=["Info on the company", "Info on customer support"],
        )
    )

    assert result.status == "skipped"
    assert (
        result.details
        == "No claims found in the output to measure faitfhulness against context, skipping entry."
    )


def test_answer_relevancy():
    evaluator = RagasAnswerRelevancyEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasAnswerRelevancyEntry(
            input="What is the capital of France?",
            output="The capital of France is Paris.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    assert result.cost and result.cost.amount > 0.0


def test_answer_correctness():
    evaluator = RagasAnswerCorrectnessEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasAnswerCorrectnessEntry(
            input="What is the capital of France?",
            output="The capital of France is Paris.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.5
    assert result.cost and result.cost.amount > 0.0


def test_answer_correctness_fail():
    evaluator = RagasAnswerCorrectnessEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasAnswerCorrectnessEntry(
            input="What is the capital of France?",
            output="The capital of France is Grenoble.",
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score < 0.5
    assert result.cost and result.cost.amount > 0.0


def test_context_relevancy():
    evaluator = RagasContextRelevancyEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasContextRelevancyEntry(
            output="The capital of France is Paris.",
            contexts=["France is a country in Europe.", "Paris is a city in France."],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.3
    assert result.cost and result.cost.amount > 0.0


def test_context_precision():
    evaluator = RagasContextPrecisionEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasContextPrecisionEntry(
            input="What is the capital of France?",
            contexts=["France is a country in Europe.", "Paris is a city in France."],
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.3
    assert result.cost and result.cost.amount > 0.0


def test_context_utilization():
    evaluator = RagasContextUtilizationEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasContextUtilizationEntry(
            input="What is the capital of France?",
            output="Paris is the capital of France.",
            contexts=[
                "France is a country in Europe.",
                "Paris is a city in France whose capital is Paris.",
            ],
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.3
    assert result.cost and result.cost.amount > 0.0


def test_context_utilization_skips_if_context_is_too_large():
    evaluator = RagasContextUtilizationEvaluator(
        settings=RagasSettings(max_tokens=2048)
    )

    result = evaluator.evaluate(
        RagasContextUtilizationEntry(
            input="What is the capital of France?",
            output="Paris is the capital of France.",
            contexts=[
                "France is a country in Europe.",
                "Paris is a city in France.",
            ]
            * 200,
        )
    )

    assert result.status == "skipped"
    assert result.details == "Total tokens exceed the maximum of 2048: 2814"


def test_context_recall():
    evaluator = RagasContextRecallEvaluator(settings=RagasSettings())

    result = evaluator.evaluate(
        RagasContextRecallEntry(
            input="What is the capital of France?",
            contexts=["France is a country in Europe.", "Paris is a city in France."],
            expected_output="Paris is the capital of France.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    assert result.cost and result.cost.amount > 0.0


def test_with_anthropic_models():
    evaluator = RagasAnswerRelevancyEvaluator(
        settings=RagasSettings(model="anthropic/claude-3-5-sonnet-20240620")
    )

    result = evaluator.evaluate(
        RagasAnswerRelevancyEntry(
            input="What is the capital of France?",
            output="The capital of France is Paris.",
        )
    )

    assert result.status == "processed"
    assert result.score and result.score > 0.9
    # TODO: capture costs on ragas with claude too
    # assert result.cost and result.cost.amount > 0.0


def test_temperature_compatibility_regression():
    """
    Regression test to ensure that models with temperature restrictions
    (like those that only support default temperature=1.0) work correctly
    with the legacy RAGAS evaluators.

    This test verifies that the fix for the temperature=0.3 issue doesn't
    cause BadRequestError for models that don't support custom temperature values.

    Note: This is a unit test that focuses on the temperature logic rather than
    making actual API calls, which would require API keys.
    """
    from langevals_legacy.vendor.legacy_ragas.llms.base import BaseRagasLLM
    from langevals_legacy.vendor.legacy_ragas.run_config import RunConfig

    # Test the temperature logic directly without making API calls
    class TestLLMWrapper(BaseRagasLLM):
        def __init__(self):
            super().__init__(run_config=RunConfig())

        def generate_text(
            self, prompt, n=1, temperature=1e-8, stop=None, callbacks=None
        ):
            # Mock implementation
            pass

        def agenerate_text(
            self, prompt, n=1, temperature=1e-8, stop=None, callbacks=None
        ):
            # Mock implementation
            pass

    llm = TestLLMWrapper()

    # Test that the temperature logic works correctly for the scenario that was failing
    # The original bug was that n > 1 would return temperature=0.3, which caused
    # BadRequestError for models that only support default temperature=1.0

    # Test single completion (should use very low temperature)
    assert llm.get_temperature(n=1) == 1e-8

    # Test multiple completions (should use default temperature=1.0, not 0.3)
    assert llm.get_temperature(n=2) == 1.0
    assert llm.get_temperature(n=3) == 1.0
    assert llm.get_temperature(n=5) == 1.0

    # Verify that we never return the problematic temperature=0.3
    for n in range(1, 10):
        temp = llm.get_temperature(n)
        assert temp != 0.3, f"Temperature should never be 0.3 for n={n}, got {temp}"
        if n == 1:
            assert temp == 1e-8, f"Single completion should use 1e-8, got {temp}"
        else:
            assert temp == 1.0, f"Multiple completions should use 1.0, got {temp}"


def test_temperature_compatibility_with_multiple_completions():
    """
    Test specifically for the scenario that triggered the original bug:
    when the RAGAS evaluator needs multiple completions (n > 1), it should
    use temperature=1.0 instead of the problematic temperature=0.3.
    """
    from langevals_legacy.vendor.legacy_ragas.llms.base import BaseRagasLLM

    # Create a mock LLM wrapper to test the temperature logic
    class MockLLMWrapper(BaseRagasLLM):
        def __init__(self):
            from langevals_legacy.vendor.legacy_ragas.run_config import RunConfig

            super().__init__(run_config=RunConfig())

        def generate_text(
            self, prompt, n=1, temperature=1e-8, stop=None, callbacks=None
        ):
            # This would be called by the actual implementation
            pass

        def agenerate_text(
            self, prompt, n=1, temperature=1e-8, stop=None, callbacks=None
        ):
            # This would be called by the actual implementation
            pass

    mock_llm = MockLLMWrapper()

    # Test the temperature logic for single completion
    assert mock_llm.get_temperature(n=1) == 1e-8

    # Test the temperature logic for multiple completions (this was the bug)
    # Should return 1.0 (default temperature) instead of 0.3
    assert mock_llm.get_temperature(n=2) == 1.0
    assert mock_llm.get_temperature(n=5) == 1.0


def test_temperature_fix_regression():
    """
    Regression test that verifies the specific fix for the temperature=0.3 issue.
    This test ensures that the get_temperature method returns the correct values
    and documents the expected behavior.
    """
    from langevals_legacy.vendor.legacy_ragas.llms.base import BaseRagasLLM
    from langevals_legacy.vendor.legacy_ragas.run_config import RunConfig

    # Create a concrete implementation to test the actual method
    class TestLLMWrapper(BaseRagasLLM):
        def __init__(self):
            super().__init__(run_config=RunConfig())

        def generate_text(
            self, prompt, n=1, temperature=1e-8, stop=None, callbacks=None
        ):
            # Mock implementation
            pass

        def agenerate_text(
            self, prompt, n=1, temperature=1e-8, stop=None, callbacks=None
        ):
            # Mock implementation
            pass

    llm = TestLLMWrapper()

    # Test cases that verify the fix
    test_cases = [
        (1, 1e-8),  # Single completion should use very low temperature
        (2, 1.0),  # Multiple completions should use default temperature (1.0)
        (3, 1.0),  # Multiple completions should use default temperature (1.0)
        (5, 1.0),  # Multiple completions should use default temperature (1.0)
    ]

    for n, expected_temp in test_cases:
        actual_temp = llm.get_temperature(n)
        assert (
            actual_temp == expected_temp
        ), f"For n={n}, expected temperature={expected_temp}, got {actual_temp}"

    # Verify that we're not using the old problematic temperature=0.3
    for n in range(2, 10):
        temp = llm.get_temperature(n)
        assert temp != 0.3, f"Temperature should not be 0.3 for n={n}, got {temp}"
        assert temp == 1.0, f"Temperature should be 1.0 for n={n}, got {temp}"
