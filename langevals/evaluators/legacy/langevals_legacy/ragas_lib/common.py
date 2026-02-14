import math
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

from langevals_legacy.lib.setup_legacy_packages import setup_legacy_packages

setup_legacy_packages()

from langevals_legacy.vendor.legacy_ragas import evaluate
from langevals_legacy.vendor.legacy_ragas.metrics.base import Metric
from langevals_legacy.vendor.legacy_ragas.llms import LangchainLLMWrapper
from langevals_legacy.vendor.legacy_ragas.metrics import (
    answer_relevancy,
    faithfulness,
    context_precision,
    context_recall,
    context_relevancy,  # type: ignore
    context_utilization,
    answer_correctness,
)
from langchain_community.callbacks import get_openai_callback
from datasets import Dataset

from langevals_legacy.ragas_lib.model_to_langchain import (
    embeddings_model_to_langchain,
    model_to_langchain,
)

from typing import List, Optional
from datasets import Dataset
from langevals_legacy.vendor.legacy_ragas import evaluate
from langevals_legacy.vendor.legacy_ragas.metrics import faithfulness, Faithfulness
from langevals_legacy.vendor.legacy_ragas.llms import LangchainLLMWrapper
from pydantic import Field
from langevals_core.utils import calculate_total_tokens
from langevals_legacy.vendor.legacy_ragas.exceptions import ExceptionInRunner
from langevals_legacy.vendor.legacy_ragas.embeddings import LangchainEmbeddingsWrapper

env_vars = []


class RagasSettings(EvaluatorSettings):
    model: str = Field(
        default="openai/gpt-5",
        description="The model to use for evaluation.",
    )
    embeddings_model: str = Field(
        default="openai/text-embedding-ada-002",
        description="The model to use for embeddings.",
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


def evaluate_ragas(
    evaluator: BaseEvaluator,
    metric: str,
    question: Optional[str] = None,
    answer: Optional[str] = None,
    contexts: Optional[List[str]] = None,
    ground_truth: Optional[str] = None,
    settings: RagasSettings = RagasSettings(),
):
    os.environ["AZURE_API_VERSION"] = "2023-07-01-preview"
    if evaluator.env:
        for key, env in evaluator.env.items():
            os.environ[key] = env

    gpt, client = model_to_langchain(settings.model)
    gpt_wrapper = LangchainLLMWrapper(langchain_llm=gpt)

    _original_generate = gpt_wrapper.generate

    def generate(*args, **kwargs):
        kwargs["is_async"] = False
        return _original_generate(*args, **kwargs)

    gpt_wrapper.generate = generate

    embeddings, embeddings_client = embeddings_model_to_langchain(
        settings.embeddings_model
    )
    embeddings_wrapper = LangchainEmbeddingsWrapper(embeddings)

    answer_relevancy.llm = gpt_wrapper
    answer_relevancy.embeddings = embeddings_wrapper  # type: ignore
    faithfulness.llm = gpt_wrapper
    if hasattr(faithfulness, "embeddings"):
        faithfulness.embeddings = embeddings_wrapper  # type: ignore
    context_precision.llm = gpt_wrapper
    if hasattr(context_precision, "embeddings"):
        context_precision.embeddings = embeddings_wrapper  # type: ignore
    context_recall.llm = gpt_wrapper
    if hasattr(context_recall, "embeddings"):
        context_recall.embeddings = embeddings_wrapper  # type: ignore
    context_relevancy.llm = gpt_wrapper
    if hasattr(context_relevancy, "embeddings"):
        context_relevancy.embeddings = embeddings_wrapper  # type: ignore
    answer_correctness.llm = gpt_wrapper
    # if hasattr(answer_correctness, "embeddings"):
    #     answer_correctness.embeddings = embeddings_wrapper  # type: ignore

    contexts = [x for x in contexts if x] if contexts else None

    total_tokens = calculate_total_tokens(
        settings.model,
        _GenericEvaluatorEntry(input=question, output=answer, contexts=contexts),
    )
    max_tokens = min(settings.max_tokens, 16384)
    if total_tokens > max_tokens:
        return EvaluationResultSkipped(
            details=f"Total tokens exceed the maximum of {max_tokens}: {total_tokens}"
        )

    ragas_metric: Metric
    if metric == "answer_relevancy":
        ragas_metric = answer_relevancy
    elif metric == "faithfulness":
        ragas_metric = faithfulness
    elif metric == "context_precision":
        ragas_metric = context_precision
    elif metric == "context_utilization":
        ragas_metric = context_utilization
    elif metric == "context_recall":
        ragas_metric = context_recall
    elif metric == "context_relevancy":
        ragas_metric = context_relevancy
    elif metric == "answer_correctness":
        ragas_metric = answer_correctness
    else:
        raise ValueError(f"Invalid metric: {metric}")

    dataset = Dataset.from_dict(
        {
            "question": [question or ""],
            "answer": [answer or ""],
            "contexts": [contexts or [""]],
            "ground_truth": [ground_truth or ""],
        }
    )

    with get_openai_callback() as cb:
        try:
            result = evaluate(dataset, metrics=[ragas_metric])
        except ExceptionInRunner as e:
            if client.exception:
                raise client.exception
            if embeddings_client.exception:
                raise embeddings_client.exception
            raise e

        score = result[metric]

    if math.isnan(score):
        if metric == "faithfulness" and isinstance(ragas_metric, Faithfulness):
            return EvaluationResultSkipped(
                details="No claims found in the output to measure faitfhulness against context, skipping entry."
            )
        raise ValueError(f"Ragas produced nan score: {score}")

    return RagasResult(
        score=score,
        cost=Money(amount=cb.total_cost, currency="USD"),
    )
