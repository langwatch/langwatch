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
from typing import Optional

from ragas.metrics import InstanceRubrics
from pydantic import BaseModel


class RagasRubricsBasedScoringEntry(EvaluatorEntry):
    input: str
    output: str
    expected_output: Optional[str] = None


class RagasRubricsBasedScoringResult(EvaluationResult):
    score: float = Field(
        default=0.0,
        description="A score according to the rubrics, typically between 1 and 5.",
    )


class RagasRubricsBasedScoringRubric(BaseModel):
    description: str


class RagasRubricsBasedScoringSettings(RagasSettings):
    rubrics: list[RagasRubricsBasedScoringRubric] = [
        RagasRubricsBasedScoringRubric(
            description="The response is incorrect, irrelevant."
        ),
        RagasRubricsBasedScoringRubric(
            description="The response partially answers the question but includes significant errors, omissions, or irrelevant information."
        ),
        RagasRubricsBasedScoringRubric(
            description="The response partially answers the question but includes minor errors, omissions, or irrelevant information."
        ),
        RagasRubricsBasedScoringRubric(
            description="The response fully answers the question and includes minor errors, omissions, or irrelevant information."
        ),
        RagasRubricsBasedScoringRubric(
            description="The response fully answers the question and includes no errors, omissions, or irrelevant information."
        ),
    ]


class RagasRubricsBasedScoringEvaluator(
    BaseEvaluator[
        RagasRubricsBasedScoringEntry,
        RagasRubricsBasedScoringSettings,
        RagasRubricsBasedScoringResult,
    ]
):
    """
    Rubric-based evaluation metric that is used to evaluate responses. The rubric consists of descriptions for each score, typically ranging from 1 to 5
    """

    name = "Rubrics Based Scoring"
    category = "quality"
    env_vars = env_vars
    default_settings = RagasRubricsBasedScoringSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/general_purpose/#rubrics-based-criteria-scoring"
    is_guardrail = False

    def evaluate(self, entry: RagasRubricsBasedScoringEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            input=entry.input,
            output=entry.output,
            expected_output=entry.expected_output,
            settings=self.settings,
        )
        if skip:
            return skip

        rubrics = {
            f"score{i + 1}_description": r.description
            for i, r in enumerate(self.settings.rubrics)
        }
        scorer = InstanceRubrics(llm=llm)

        _original_generate = scorer.single_turn_prompt.generate

        breakdown = None

        async def generate(*args, **kwargs):
            nonlocal breakdown
            result = await _original_generate(*args, **kwargs)
            breakdown = result
            return result

        scorer.single_turn_prompt.generate = generate

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    user_input=entry.input,
                    response=entry.output,
                    reference=entry.expected_output,
                    rubrics=rubrics,
                )
            )

        return RagasResult(
            score=score,
            cost=cost,
            details=breakdown.feedback if breakdown else None,
        )
