import time
import dspy
import dspy.evaluate

from langwatch_nlp.studio.dspy.evaluation import EvaluationResultWithMetadata, Evaluator


class ExactMatchEvaluator(Evaluator):
    def __init__(self):
        super().__init__()

    @Evaluator.trace_evaluation
    def forward(
        self, output: str, expected_output: str
    ) -> EvaluationResultWithMetadata:
        super().forward()

        start_time = time.time()
        try:
            result = dspy.evaluate.answer_exact_match(
                dspy.Example(
                    answer=expected_output if expected_output is not None else ""
                ),
                dspy.Prediction(answer=output if output is not None else ""),
            )

            return EvaluationResultWithMetadata(
                status="processed",
                inputs={"output": output, "expected_output": expected_output},
                score=float(result),
                passed=result,
                duration=round(time.time() - start_time),
            )
        except AssertionError as e:
            return EvaluationResultWithMetadata(
                status="error",
                details=e.__repr__(),
                inputs={"output": output, "expected_output": expected_output},
                duration=round(time.time() - start_time),
            )
