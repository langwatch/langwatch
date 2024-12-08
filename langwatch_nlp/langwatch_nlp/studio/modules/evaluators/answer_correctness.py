import dspy

from langevals_core.base_evaluator import (
    EvaluationResult,
    SingleEvaluationResult,
    Money,
)

from langwatch_nlp.studio.dspy.evaluation import Evaluator
from langwatch_nlp.studio.dspy.predict_with_metadata import ModuleWithMetadata
from langwatch_nlp.studio.types.dsl import LLMConfig
from langwatch_nlp.studio.utils import node_llm_config_to_dspy_lm


class AnswerCorrectnessSignature(dspy.Signature):
    """Verify that the predicted answer matches the gold answer."""

    question = dspy.InputField()
    gold_answer = dspy.InputField(desc="correct answer for question")
    predicted_answer = dspy.InputField(desc="predicted answer for question")
    is_correct = dspy.OutputField(desc="True or False")


class AnswerCorrectness(dspy.Module):
    def __init__(self):
        super().__init__()
        self.evaluate_correctness = dspy.ChainOfThought(AnswerCorrectnessSignature)

    def forward(self, question, gold_answer, predicted_answer):
        return self.evaluate_correctness(
            question=question,
            gold_answer=gold_answer,
            predicted_answer=predicted_answer,
        )


class AnswerCorrectnessEvaluator(Evaluator):
    def __init__(self, llm: LLMConfig):
        super().__init__()

        self.evaluator = ModuleWithMetadata(AnswerCorrectness())

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
