import dspy
import dspy.evaluate

from langevals_core.base_evaluator import (
    EvaluationResult,
    SingleEvaluationResult,
)


class ExactMatchEvaluator(dspy.Module):
    def __init__(self):
        super().__init__()

    def forward(self, output: str, expected_output: str) -> SingleEvaluationResult:
        result = dspy.evaluate.answer_exact_match(
            dspy.Example(answer=expected_output), dspy.Prediction(answer=output)
        )

        return EvaluationResult(
            score=float(result),
            passed=result,
        )
