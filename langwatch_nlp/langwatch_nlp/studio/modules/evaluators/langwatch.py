from typing import Optional
import dspy
import dspy.evaluate

from langevals_core.base_evaluator import (
    EvaluationResult,
    EvaluationResultSkipped,
    EvaluationResultError,
    SingleEvaluationResult,
    Money,
)
import langwatch

from langwatch_nlp.studio.dspy.evaluation import Evaluator


class LangWatchEvaluator(Evaluator):
    def __init__(
        self,
        api_key: str,
        evaluator: str,
        name: str,
        settings: dict,
    ):
        super().__init__()
        self.api_key = api_key
        self.evaluator = evaluator
        self.name = name
        self.settings = settings

    def forward(self, **kwargs) -> SingleEvaluationResult:
        super().forward()

        if "contexts" in kwargs and type(kwargs["contexts"]) != list:
            kwargs["contexts"] = [kwargs["contexts"]]

        result = langwatch.evaluations.evaluate(
            self.evaluator,
            name=self.name,
            settings=self.settings,
            api_key=self.api_key,
            **kwargs,
        )

        if result.status == "processed":
            return EvaluationResult(
                score=result.score or 0,
                passed=result.passed,
                details=result.details,
                label=result.label,
                cost=(
                    Money(currency=result.cost.currency, amount=result.cost.amount)
                    if result.cost
                    else None
                ),
            )
        elif result.status == "skipped":
            return EvaluationResultSkipped(
                details=result.details or "",
            )
        else:
            return EvaluationResultError(
                details=result.details or "",
                error_type="Error",
                traceback=[],
            )
