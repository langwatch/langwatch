from typing import Sequence
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
from ragas.metrics import ResponseRelevancy
from ragas.metrics._answer_relevance import ResponseRelevanceOutput


class RagasResponseRelevancyEntry(EvaluatorEntry):
    input: str
    output: str


class RagasResponseRelevancyResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score between 0.0 and 1.0 indicating the relevance of the answer.",
    )


class RagasResponseRelevancySettings(RagasSettings):
    embeddings_model: str = Field(
        default="openai/text-embedding-ada-002",
        description="The model to use for embeddings.",
    )


class RagasResponseRelevancyEvaluator(
    BaseEvaluator[
        RagasResponseRelevancyEntry,
        RagasResponseRelevancySettings,
        RagasResponseRelevancyResult,
    ]
):
    """
    Evaluates how pertinent the generated answer is to the given prompt. Higher scores indicate better relevancy.
    """

    name = "Ragas Response Relevancy"
    category = "quality"
    env_vars = env_vars
    default_settings = RagasResponseRelevancySettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/answer_relevance/"
    is_guardrail = False

    def evaluate(self, entry: RagasResponseRelevancyEntry) -> SingleEvaluationResult:
        llm, embeddings = prepare_llm(self, self.settings, temperature=0.7)

        skip = check_max_tokens(
            input=entry.input,
            output=entry.output,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = ResponseRelevancy(llm=llm, embeddings=embeddings)

        _original_calculate_similarity = scorer.calculate_similarity
        _original_calculate_score = scorer._calculate_score

        breakdown = {"similarity": 0, "answers": []}

        def calculate_similarity(question: str, generated_questions):
            nonlocal breakdown
            similarity = _original_calculate_similarity(question, generated_questions)
            breakdown["similarity"] += similarity
            return similarity

        def _calculate_score(answers: Sequence[ResponseRelevanceOutput], row: dict):
            nonlocal breakdown
            breakdown["answers"] += answers
            return _original_calculate_score(answers, row)

        scorer.calculate_similarity = calculate_similarity
        scorer._calculate_score = _calculate_score

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    user_input=entry.input,
                    response=entry.output,
                )
            )

        generated_questions = "\n".join(
            [f"- {answer.question}" for answer in breakdown["answers"]]
        )

        if len([answer for answer in breakdown["answers"] if answer.question]) == 0:
            return EvaluationResultSkipped(
                details="No questions could be generated from output.",
            )

        any_noncommittal = any([answer.noncommittal for answer in breakdown["answers"]])

        return RagasResult(
            score=score,
            cost=cost,
            details=f"Questions generated from output:\n\n{generated_questions}\n\nSimilarity to original question: {breakdown['similarity']}\nEvasive answer: {any_noncommittal}",
        )
