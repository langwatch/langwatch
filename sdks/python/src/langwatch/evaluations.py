"""
langwatch.evaluations - DEPRECATED, use langwatch.evaluation instead.

This module is kept for backward compatibility. All functionality has moved
to langwatch.evaluation (singular).

Example migration:
    # Old (deprecated)
    from langwatch.evaluations import evaluate
    result = evaluate("presidio/pii_detection", input="test", output="response")

    # New (recommended)
    import langwatch
    result = langwatch.evaluation.evaluate(
        "presidio/pii_detection",
        data={"input": "test", "output": "response"}
    )
"""
import warnings
from typing import Any, Dict, List, Literal, Optional, Union, TYPE_CHECKING
from uuid import UUID

from deprecated import deprecated

# Re-export everything from the evaluation module
from langwatch.evaluation import (
    # Types
    BasicEvaluateData,
    EvaluationResultModel,
    # Internal functions
    _prepare_data as _new_prepare_data,
    _handle_response,
    _handle_exception,
    _add_evaluation as _new_add_evaluation,
)

from langwatch.types import (
    Conversation,
    EvaluationTimestamps,
    Money,
    MoneyDict,
    RAGChunk,
)

if TYPE_CHECKING:
    from langwatch.telemetry.tracing import LangWatchTrace
    from langwatch.telemetry.span import LangWatchSpan


@deprecated(
    reason="Please use `langwatch.evaluation.evaluate()` instead."
)
def evaluate(
    slug: str,
    name: Optional[str] = None,
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    conversation: Optional[Conversation] = None,
    settings: Optional[Dict[str, Any]] = None,
    as_guardrail: bool = False,
    trace: Optional["LangWatchTrace"] = None,
    span: Optional["LangWatchSpan"] = None,
    api_key: Optional[str] = None,
    data: Optional[Union[BasicEvaluateData, Dict[str, Any]]] = None,
) -> EvaluationResultModel:
    """
    Deprecated: Use langwatch.evaluation.evaluate() instead.

    The new API uses a simpler signature:
        langwatch.evaluation.evaluate(slug, data, name, settings, as_guardrail)
    """
    import langwatch.evaluation as evaluation

    if trace:
        warnings.warn(
            "The `trace` argument is deprecated and will be removed.",
            DeprecationWarning,
            stacklevel=2,
        )

    # Build data dict from legacy arguments
    data_dict: Dict[str, Any] = {}
    if data:
        if isinstance(data, BasicEvaluateData):
            data_dict = data.model_dump(exclude_unset=True, exclude_none=True)
        else:
            data_dict = data

    # Map legacy positional arguments to data dict
    if input is not None:
        warnings.warn(
            "The `input` argument is deprecated. Use `data={'input': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["input"] = input
    if output is not None:
        warnings.warn(
            "The `output` argument is deprecated. Use `data={'output': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["output"] = output
    if expected_output is not None:
        warnings.warn(
            "The `expected_output` argument is deprecated. Use `data={'expected_output': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["expected_output"] = expected_output
    if contexts is not None:
        warnings.warn(
            "The `contexts` argument is deprecated. Use `data={'contexts': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["contexts"] = contexts
    if expected_contexts is not None:
        warnings.warn(
            "The `expected_contexts` argument is deprecated. Use `data={'expected_contexts': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["expected_contexts"] = expected_contexts
    if conversation is not None:
        warnings.warn(
            "The `conversation` argument is deprecated. Use `data={'conversation': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["conversation"] = conversation

    return evaluation.evaluate(
        slug=slug,
        data=data_dict,
        name=name,
        settings=settings,
        as_guardrail=as_guardrail,
    )


@deprecated(
    reason="Please use `langwatch.evaluation.async_evaluate()` instead."
)
async def async_evaluate(
    slug: str,
    name: Optional[str] = None,
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    conversation: Optional[Conversation] = None,
    settings: Optional[Dict[str, Any]] = None,
    as_guardrail: bool = False,
    trace: Optional["LangWatchTrace"] = None,
    span: Optional["LangWatchSpan"] = None,
    api_key: Optional[str] = None,
    data: Optional[Union[BasicEvaluateData, Dict[str, Any]]] = None,
) -> EvaluationResultModel:
    """
    Deprecated: Use langwatch.evaluation.async_evaluate() instead.

    The new API uses a simpler signature:
        langwatch.evaluation.async_evaluate(slug, data, name, settings, as_guardrail)
    """
    import langwatch.evaluation as evaluation

    if trace:
        warnings.warn(
            "The `trace` argument is deprecated and will be removed.",
            DeprecationWarning,
            stacklevel=2,
        )

    # Build data dict from legacy arguments
    data_dict: Dict[str, Any] = {}
    if data:
        if isinstance(data, BasicEvaluateData):
            data_dict = data.model_dump(exclude_unset=True, exclude_none=True)
        else:
            data_dict = data

    # Map legacy positional arguments to data dict
    if input is not None:
        warnings.warn(
            "The `input` argument is deprecated. Use `data={'input': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["input"] = input
    if output is not None:
        warnings.warn(
            "The `output` argument is deprecated. Use `data={'output': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["output"] = output
    if expected_output is not None:
        warnings.warn(
            "The `expected_output` argument is deprecated. Use `data={'expected_output': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["expected_output"] = expected_output
    if contexts is not None:
        warnings.warn(
            "The `contexts` argument is deprecated. Use `data={'contexts': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["contexts"] = contexts
    if expected_contexts is not None:
        warnings.warn(
            "The `expected_contexts` argument is deprecated. Use `data={'expected_contexts': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["expected_contexts"] = expected_contexts
    if conversation is not None:
        warnings.warn(
            "The `conversation` argument is deprecated. Use `data={'conversation': ...}` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        data_dict["conversation"] = conversation

    return await evaluation.async_evaluate(
        slug=slug,
        data=data_dict,
        name=name,
        settings=settings,
        as_guardrail=as_guardrail,
    )


@deprecated(
    reason="Please use the new `langwatch.evaluation` module instead."
)
def _add_evaluation(
    *,
    span: Optional["LangWatchSpan"] = None,
    evaluation_id: Optional[str] = None,
    name: str,
    type: Optional[str] = None,
    is_guardrail: Optional[bool] = None,
    status: Literal["processed", "skipped", "error"] = "processed",
    passed: Optional[bool] = None,
    score: Optional[float] = None,
    label: Optional[str] = None,
    details: Optional[str] = None,
    cost: Optional[Union[Money, MoneyDict, float]] = None,
    error: Optional[Exception] = None,
    timestamps: Optional[EvaluationTimestamps] = None,
):
    """
    Deprecated: Use langwatch.evaluation._add_evaluation() instead.
    """
    return _new_add_evaluation(
        span=span,
        evaluation_id=evaluation_id,
        name=name,
        type=type,
        is_guardrail=is_guardrail,
        status=status,
        passed=passed,
        score=score,
        label=label,
        details=details,
        cost=cost,
        error=error,
        timestamps=timestamps,
    )


__all__ = [
    "evaluate",
    "async_evaluate",
    "BasicEvaluateData",
    "EvaluationResultModel",
    "_add_evaluation",
]
