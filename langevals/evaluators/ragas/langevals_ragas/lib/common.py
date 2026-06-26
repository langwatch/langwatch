from contextlib import contextmanager
from dataclasses import dataclass
import os
from typing import List, Optional
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorSettings,
    Money,
    EvaluationResultSkipped,
    EvaluatorEntry,
)
from pydantic import Field
from ragas.llms import LangchainLLMWrapper
from langchain_community.callbacks import get_openai_callback

from langevals_ragas.lib.model_to_langchain import (
    embeddings_model_to_langchain,
    model_to_langchain,
)

from ragas.llms import LangchainLLMWrapper
from pydantic import Field
from langevals_core.utils import calculate_total_tokens
from ragas.embeddings import LangchainEmbeddingsWrapper
from litellm.cost_calculator import cost_per_token

env_vars = []


class RagasSettings(EvaluatorSettings):
    model: str = Field(
        default="openai/gpt-5-mini",
        description="The model to use for evaluation.",
    )
    max_tokens: int = Field(
        default=2048,
        description="The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
    )


class RagasResult(EvaluationResult):
    score: float = Field(default=0.0)


class _GenericEvaluatorEntry(EvaluatorEntry):
    input: Optional[str]
    output: Optional[str]
    contexts: Optional[List[str]]
    expected_output: Optional[str]


def prepare_llm(
    evaluator: BaseEvaluator,
    settings: RagasSettings = RagasSettings(),
    temperature: float = 0,
):
    os.environ.setdefault("AZURE_API_VERSION", "2024-02-01")
    if evaluator.env:
        for key, env in evaluator.env.items():
            os.environ[key] = env

    gpt = model_to_langchain(settings.model, temperature=temperature)
    llm = LangchainLLMWrapper(langchain_llm=gpt)

    if hasattr(settings, "embeddings_model"):
        embeddings = embeddings_model_to_langchain(settings.embeddings_model)  # type: ignore
        embeddings_wrapper = LangchainEmbeddingsWrapper(embeddings)
    else:
        embeddings_wrapper = None

    return llm, embeddings_wrapper


def clear_context(
    retrieved_contexts: Optional[List[str]] = None,
):
    return (
        [x for x in retrieved_contexts if x] if retrieved_contexts is not None else None
    )


def check_max_tokens(
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: Optional[List[str]] = None,
    settings: RagasSettings = RagasSettings(),
):
    total_tokens = calculate_total_tokens(
        settings.model,
        _GenericEvaluatorEntry(
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
        ),
    )
    max_tokens = min(settings.max_tokens, 16384)
    if total_tokens > max_tokens:
        return EvaluationResultSkipped(
            details=f"Total tokens exceed the maximum of {max_tokens}: {total_tokens}"
        )
    return None


@dataclass
class CapturedCost:
    """Mutable holder for the cost captured by :func:`capture_cost`.

    The cost can only be computed on teardown — after the ``with`` block has run
    the evaluation and the token usage is known — so callers read ``.money``
    *after* the block. ``money`` is ``None`` when the model's price is unknown
    (see :func:`capture_cost`).
    """

    money: Optional[Money]


@contextmanager
def capture_cost(llm: LangchainLLMWrapper):
    with get_openai_callback() as cb:
        captured = CapturedCost(money=Money(amount=0, currency="USD"))
        yield captured

        prompt_tokens = cb.prompt_tokens
        completion_tokens = cb.completion_tokens
        model = llm.langchain_llm.model_name  # type: ignore
        try:
            prompt_cost, completion_cost = cost_per_token(
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            captured.money = Money(amount=prompt_cost + completion_cost, currency="USD")
        except Exception as e:
            if "This model isn't mapped yet" in str(e):
                # litellm has no price for this model, so the cost is genuinely
                # unknown. Report it as None rather than a misleading $0, which
                # would understate evaluation spend in cost dashboards.
                # TODO: pass in a user-provided cost mapping here to price
                # otherwise-unmapped models.
                captured.money = None
            else:
                raise e
