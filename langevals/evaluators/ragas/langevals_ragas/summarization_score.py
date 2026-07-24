from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
    SingleEvaluationResult,
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

from ragas.metrics import SummarizationScore


class RagasSummarizationScoreEntry(EvaluatorEntry):
    output: str
    contexts: list[str]


class RagasSummarizationScoreResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the summarization quality.",
    )


class RagasSummarizationScoreEvaluator(
    BaseEvaluator[
        RagasSummarizationScoreEntry,
        RagasSettings,
        RagasSummarizationScoreResult,
    ]
):
    """
    Measures how well the summary captures important information from the retrieved contexts.
    """

    name = "Summarization Score"
    category = "quality"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/summarization_score/"
    is_guardrail = False

    def evaluate(self, entry: RagasSummarizationScoreEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            output=entry.output,
            contexts=entry.contexts,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = SummarizationScore(llm=llm)

        _original_compute_score = scorer._compute_score

        breakdown = {}

        def compute_score(scores):
            nonlocal breakdown
            breakdown = scores
            return _original_compute_score(scores)

        scorer._compute_score = compute_score

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    response=entry.output,
                    # TODO: there is a mismatch between docs and actual implementation, docs says retrieved_contexts
                    # but it's reference_contexts, check back in a few months which direction Ragas actually went at
                    # at the end, for now, we'll pass both to avoid breaking changes
                    retrieved_contexts=entry.contexts,
                    reference_contexts=entry.contexts,
                )
            )

        details = f"QA Score: {breakdown['qa_score']:.2f}"
        if "conciseness_score" in breakdown:
            details += f"\nConciseness Score: {breakdown['conciseness_score']:.2f}"

        return RagasResult(
            score=score,
            cost=cost,
            details=details,
        )
