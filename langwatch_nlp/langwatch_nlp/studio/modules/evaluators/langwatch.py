import json
import time
import langwatch

from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    Evaluator,
    Money,
)
from langwatch.evaluations import EvaluationResultModel
from dspy.clients.cache import request_cache

from langwatch_nlp.studio.utils import SerializableWithPydanticAndPredictEncoder


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

    # Hack for types autoparsing
    def _forward_signature(
        self,
        *,
        input: str,
        output: str,
        expected_output: str,
        contexts: list[str],
        expected_contexts: list[str],
    ):
        pass

    def forward(self, **kwargs) -> EvaluationResultWithMetadata:
        super().forward()

        start_time = time.time()
        result = _cached_langwatch_evaluate(
            self.evaluator,
            name=self.name,
            settings=self.settings,
            api_key=self.api_key,
            **kwargs,
        )

        duration = round(time.time() - start_time)

        if result.status == "processed":
            return EvaluationResultWithMetadata(
                status="processed",
                score=float(result.score) if result.score is not None else 0,
                passed=result.passed,
                details=result.details,
                label=result.label,
                cost=(
                    Money(currency=result.cost.currency, amount=result.cost.amount)
                    if result.cost
                    else None
                ),
                inputs=kwargs,
                duration=duration,
            )
        elif result.status == "skipped":
            return EvaluationResultWithMetadata(
                status="skipped",
                details=result.details or "",
                inputs=kwargs,
                duration=duration,
            )
        else:
            print(f"Error running {self.evaluator} evaluator:", result.details)
            return EvaluationResultWithMetadata(
                status="error",
                details=result.details or "",
                inputs=kwargs,
                duration=duration,
            )


@request_cache(ignored_args_for_cache_key=["api_key"])
def _cached_langwatch_evaluate(
    evaluator: str, name: str, settings: dict, api_key: str, **kwargs
) -> EvaluationResultModel:
    return langwatch.evaluations.evaluate(
        evaluator,
        name=name,
        settings=settings,
        api_key=api_key,
        data=kwargs,
    )
