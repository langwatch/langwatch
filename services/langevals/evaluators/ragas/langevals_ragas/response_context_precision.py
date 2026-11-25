from typing import Optional
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
    EvaluationResultSkipped,
)
from ragas import SingleTurnSample
from .lib.common import (
    RagasResult,
    capture_cost,
    check_max_tokens,
    env_vars,
    RagasSettings,
    prepare_llm,
)
from pydantic import Field

from ragas.metrics import (
    LLMContextPrecisionWithReference,
    LLMContextPrecisionWithoutReference,
)


class RagasResponseContextPrecisionEntry(EvaluatorEntry):
    input: str
    output: Optional[str] = None
    contexts: list[str]
    expected_output: Optional[str] = None


class RagasResponseContextPrecisionResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the precision of the retrieved context.",
    )


class RagasResponseContextPrecisionEvaluator(
    BaseEvaluator[
        RagasResponseContextPrecisionEntry,
        RagasSettings,
        RagasResponseContextPrecisionResult,
    ]
):
    """
    Uses an LLM to measure the proportion of chunks in the retrieved context that were relevant to generate the output or the expected output.
    """

    name = "Ragas Response Context Precision"
    category = "rag"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/#context-precision-without-reference"
    is_guardrail = False

    def evaluate(
        self, entry: RagasResponseContextPrecisionEntry
    ) -> SingleEvaluationResult:
        if not entry.output and not entry.expected_output:
            return EvaluationResultSkipped(
                details="Either output or expected_output must be provided.",
            )

        llm, _ = prepare_llm(self, self.settings)

        # Both scorers below read the question and the retrieved contexts, and
        # the contexts are the bulk of a RAG payload, so the guard has to count
        # them. Which of output and expected_output is scored depends on the
        # same condition the scorer is picked by.
        skip = check_max_tokens(
            input=entry.input,
            output=None if entry.expected_output else entry.output,
            expected_output=entry.expected_output,
            contexts=entry.contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        if entry.expected_output:
            scorer = LLMContextPrecisionWithReference(llm=llm)

            with capture_cost(llm) as cost:
                score = scorer.single_turn_score(
                    SingleTurnSample(
                        user_input=entry.input,
                        reference=entry.expected_output,
                        retrieved_contexts=entry.contexts,
                    )
                )
        else:
            scorer = LLMContextPrecisionWithoutReference(llm=llm)
            with capture_cost(llm) as cost:
                score = scorer.single_turn_score(
                    SingleTurnSample(
                        user_input=entry.input,
                        response=entry.output,
                        retrieved_contexts=entry.contexts,
                    )
                )

        return RagasResult(
            score=score,
            cost=cost,
            details=None,
        )
