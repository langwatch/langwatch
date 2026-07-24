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

from ragas.metrics import LLMSQLEquivalence


class RagasSQLQueryEquivalenceEntry(EvaluatorEntry):
    output: str
    expected_output: str
    expected_contexts: list[str]


class RagasSQLQueryEquivalenceResult(EvaluationResult):
    passed: bool = Field(
        default=False,
        description="Whether the SQL query is equivalent to the expected one.",
    )


class RagasSQLQueryEquivalenceEvaluator(
    BaseEvaluator[
        RagasSQLQueryEquivalenceEntry,
        RagasSettings,
        RagasSQLQueryEquivalenceResult,
    ]
):
    """
    Checks if the SQL query is equivalent to a reference one by using an LLM to infer if it would generate the same results given the table schemas.
    """

    name = "SQL Query Equivalence"
    category = "quality"
    env_vars = env_vars
    default_settings = RagasSettings()
    docs_url = "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/sql/#sql-query-semantic-equivalence"
    is_guardrail = False

    def evaluate(self, entry: RagasSQLQueryEquivalenceEntry) -> SingleEvaluationResult:
        llm, _ = prepare_llm(self, self.settings)

        skip = check_max_tokens(
            output=entry.output,
            expected_output=entry.expected_output,
            settings=self.settings,
        )
        if skip:
            return skip

        scorer = LLMSQLEquivalence(llm=llm)

        _original_generate = scorer.equivalence_prompt.generate

        breakdown = None

        async def generate(*args, **kwargs):
            nonlocal breakdown
            result = await _original_generate(*args, **kwargs)
            breakdown = result
            return result

        scorer.equivalence_prompt.generate = generate

        with capture_cost(llm) as cost:
            score = scorer.single_turn_score(
                SingleTurnSample(
                    response=entry.output,
                    reference=entry.expected_output,
                    reference_contexts=entry.expected_contexts,
                )
            )

        return RagasSQLQueryEquivalenceResult(
            passed=score >= 0.5,
            cost=cost,
            details=(
                f"Response query explaination: {breakdown.response_query_explaination}\nReference query explaination: {breakdown.reference_query_explaination}\nEquivalence: {breakdown.equivalence}"
                if breakdown
                else None
            ),
        )
