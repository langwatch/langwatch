import time
import dspy
import dspy.evaluate

from langwatch_nlp.studio.dspy.evaluation import EvaluationResultWithMetadata, Evaluator


class EvaluatorWrapper(Evaluator):
    def __init__(self, wrapped: dspy.Module):
        super().__init__()
        self.wrapped = wrapped

    @Evaluator.trace_evaluation
    def forward(self, **kwargs) -> EvaluationResultWithMetadata:
        super().forward()

        start_time = time.time()
        result = self.wrapped(**kwargs)

        try:
            return EvaluationResultWithMetadata.model_validate(
                {
                    "status": "processed",
                    **result.model_dump(),
                    "inputs": kwargs,
                    "duration": round(time.time() - start_time),
                }
            )
        except Exception as e:
            return EvaluationResultWithMetadata(
                status="error",
                details=str(e),
                inputs=kwargs,
                duration=round(time.time() - start_time),
            )
