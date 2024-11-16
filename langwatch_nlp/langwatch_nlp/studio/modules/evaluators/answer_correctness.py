import dspy
import dspy.evaluate

from langevals_core.base_evaluator import (
    EvaluationResult,
    SingleEvaluationResult,
    Money,
)

from langwatch_nlp.studio.dspy.evaluation import Evaluator
from langwatch_nlp.studio.dspy.predict_with_metadata import ModuleWithMetadata
from langwatch_nlp.studio.types.dsl import LLMConfig
from langwatch_nlp.studio.utils import node_llm_config_to_dspy_lm


class AnswerCorrectnessEvaluator(Evaluator):
    def __init__(self, llm: LLMConfig):
        super().__init__()

        self.evaluator = ModuleWithMetadata(dspy.evaluate.AnswerCorrectness())

        lm = node_llm_config_to_dspy_lm(llm)
        dspy.settings.configure(experimental=True)
        self.evaluator.set_lm(lm=lm)

    @Evaluator.trace_evaluation
    def forward(
        self, input: str, output: str, expected_output: str
    ) -> SingleEvaluationResult:
        super().forward()

        result = self.evaluator(
            question=input, gold_answer=expected_output, predicted_answer=output
        )

        passed = str(result.is_correct) == "True"
        return EvaluationResult(
            score=1 if passed else 0,
            passed=passed,
            cost=Money(currency="USD", amount=result.get_cost()),
        )
