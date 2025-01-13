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
from langwatch.evaluations import EvaluationResultModel
from dsp.modules.cache_utils import CacheMemory


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
        if "expected_contexts" in kwargs and type(kwargs["expected_contexts"]) != list:
            kwargs["expected_contexts"] = [kwargs["expected_contexts"]]

        result = _cached_langwatch_evaluate(
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
                error_type=result.error_type or "Error",
                traceback=[],
            )


@CacheMemory.cache
def _cached_langwatch_evaluate(
    evaluator: str, name: str, settings: dict, api_key: str, **kwargs
) -> EvaluationResultModel:
    return langwatch.evaluations.evaluate(
        evaluator,
        name=name,
        settings=settings,
        api_key=api_key,
        **kwargs,
    )
