import dspy
import dspy.evaluate

from langevals_core.base_evaluator import (
    EvaluationResult,
    SingleEvaluationResult,
)

from langwatch_nlp.studio.dspy.evaluation import Evaluator


class EvaluatorWrapper(Evaluator):
    def __init__(self, wrapped: dspy.Module):
        super().__init__()
        self.wrapped = wrapped

    @Evaluator.trace_evaluation
    def forward(self, **kwargs) -> SingleEvaluationResult:
        super().forward()

        result = self.wrapped(**kwargs)

        return EvaluationResult.model_validate(result)
