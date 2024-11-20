import dspy
import dspy.evaluate

from langevals_core.base_evaluator import (
    EvaluationResult,
    SingleEvaluationResult,
)

from langwatch_nlp.studio.dspy.evaluation import Evaluator


class ExactMatchEvaluator(Evaluator):
    def __init__(self):
        super().__init__()

    @Evaluator.trace_evaluation
    def forward(self, output: str, expected_output: str) -> SingleEvaluationResult:
        super().forward()

        result = dspy.evaluate.answer_exact_match(
            dspy.Example(answer=expected_output), dspy.Prediction(answer=output)
        )

        return EvaluationResult(
            score=float(result),
            passed=result,
        )
