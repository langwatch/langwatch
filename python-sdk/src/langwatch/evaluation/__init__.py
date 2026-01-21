"""
langwatch.evaluation - Online Evaluations and Guardrails API

This module provides the ability to run evaluators and guardrails in real-time
against LLM inputs/outputs.

Example:
    ```python
    import langwatch

    # Run a guardrail
    guardrail = langwatch.evaluation.evaluate(
        "presidio/pii_detection",
        data={"input": user_input, "output": generated_response},
        name="PII Detection",
        as_guardrail=True,
    )

    if not guardrail.passed:
        return "I'm sorry, I can't do that."
    ```

This module also provides backward compatibility for the deprecated evaluation/experiment API.
For batch experiments, use `langwatch.experiment` instead.
"""
import json
import warnings
from typing import Any, Dict, List, Literal, Optional, Union, cast, TYPE_CHECKING
from uuid import UUID

import httpx
import langwatch
from langwatch.domain import SpanTimestamps
from pksuid import PKSUID
from langwatch.telemetry.span import LangWatchSpan
from langwatch.telemetry.context import get_current_span
from langwatch.state import get_api_key, get_endpoint, get_instance
from langwatch.attributes import AttributeKey
from langwatch.utils.exceptions import EvaluatorException, better_raise_for_status
from pydantic import BaseModel

from langwatch.types import (
    Conversation,
    Evaluation as _EvaluationTypedDict,
    EvaluationResult,
    EvaluationTimestamps,
    Money,
    MoneyDict,
    SpanMetrics,
    RAGChunk,
    TypedValueEvaluationResult,
    TypedValueGuardrailResult,
    TypedValueJson,
)
from langwatch.utils.exceptions import capture_exception
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
)

# Re-export from experiment module for backward compatibility
from langwatch.experiment.experiment import Experiment as _Experiment
from langwatch.experiment.platform_run import (
    run as _experiment_run,
    ExperimentRunResult,
    ExperimentRunSummary,
    ExperimentNotFoundError,
    ExperimentTimeoutError,
    ExperimentRunFailedError,
    ExperimentsApiError,
    TargetStats,
    EvaluatorStats,
)

if TYPE_CHECKING:
    from langwatch.telemetry.tracing import LangWatchTrace


# ============================================================================
# Online Evaluation / Guardrail Types
# ============================================================================

class BasicEvaluateData(BaseModel):
    """Helper class for structuring evaluation data."""

    input: Optional[str] = None
    output: Optional[str] = None
    expected_output: Optional[str] = None
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None
    conversation: Optional[Conversation] = None


class EvaluationResultModel(BaseModel):
    """Result model returned from running an evaluator."""

    status: Literal["processed", "skipped", "error"]
    passed: Optional[bool] = None
    score: Optional[float] = None
    details: Optional[str] = None
    label: Optional[str] = None
    cost: Optional[Money] = None
    error_type: Optional[str] = None


# ============================================================================
# Online Evaluation / Guardrail Functions
# ============================================================================


def evaluate(
    slug: str,
    data: Union[BasicEvaluateData, Dict[str, Any]],
    name: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
    as_guardrail: bool = False,
) -> EvaluationResultModel:
    """
    Run an evaluator or guardrail against provided data.

    Creates an OpenTelemetry span attached to the current trace context,
    calls the LangWatch evaluation API, and returns the result.

    Args:
        slug: The evaluator slug (e.g., "presidio/pii_detection", "langevals/llm_boolean")
        data: Data to pass to the evaluator (input, output, contexts, etc.)
        name: Human-readable name for this evaluation
        settings: Evaluator-specific settings
        as_guardrail: Whether to run as a guardrail (affects error handling)

    Returns:
        EvaluationResultModel with status, passed, score, details, label, and cost

    Example:
        ```python
        import langwatch

        # Run as a guardrail (synchronous evaluation that can block responses)
        guardrail = langwatch.evaluation.evaluate(
            "presidio/pii_detection",
            data={"input": user_input, "output": generated_response},
            name="PII Detection Guardrail",
            as_guardrail=True,
        )

        if not guardrail.passed:
            print("PII detected:", guardrail.details)
            return "Sorry, I cannot process that request."
        ```
    """
    with langwatch.span(
        name=name or slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = _prepare_data(
            slug=slug,
            name=name,
            data=data,
            settings=settings,
            span=span,
            as_guardrail=as_guardrail,
        )
        try:
            with httpx.Client(timeout=900) as client:
                response = client.post(**request_params)
                better_raise_for_status(response, cls=EvaluatorException)
        except Exception as e:
            return _handle_exception(e, span, as_guardrail)

        return _handle_response(response.json(), span, as_guardrail)

    raise ValueError("Evaluate failed due to issue creating span")


async def async_evaluate(
    slug: str,
    data: Union[BasicEvaluateData, Dict[str, Any]],
    name: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
    as_guardrail: bool = False,
) -> EvaluationResultModel:
    """
    Async version of evaluate().

    Run an evaluator or guardrail against provided data asynchronously.

    Args:
        slug: The evaluator slug (e.g., "presidio/pii_detection", "langevals/llm_boolean")
        data: Data to pass to the evaluator (input, output, contexts, etc.)
        name: Human-readable name for this evaluation
        settings: Evaluator-specific settings
        as_guardrail: Whether to run as a guardrail (affects error handling)

    Returns:
        EvaluationResultModel with status, passed, score, details, label, and cost

    Example:
        ```python
        import langwatch

        # Run as an online evaluation (async scoring for monitoring)
        result = await langwatch.evaluation.async_evaluate(
            "langevals/llm_boolean",
            data={"input": question, "output": response},
            name="Quality Check",
            settings={"prompt": "Check if the response answers the question."},
        )

        print("Score:", result.score)
        ```
    """
    with langwatch.span(
        name=name or slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = _prepare_data(
            slug=slug,
            name=name,
            data=data,
            settings=settings,
            span=span,
            as_guardrail=as_guardrail,
        )
        try:
            async with httpx.AsyncClient(timeout=900) as client:
                response = await client.post(**request_params)
                better_raise_for_status(response)
        except Exception as e:
            return _handle_exception(e, span, as_guardrail)

        return _handle_response(response.json(), span, as_guardrail)

    raise ValueError("Async evaluate failed due to issue creating span")


def _prepare_data(
    slug: str,
    name: Optional[str],
    data: Union[BasicEvaluateData, Dict[str, Any]],
    settings: Optional[Dict[str, Any]] = None,
    span: Optional["LangWatchSpan"] = None,
    as_guardrail: bool = False,
):
    """Prepare request data for the evaluation API."""
    trace_data: Dict[str, Any] = {}

    span_ctx = get_current_span().get_span_context()
    if span_ctx and span_ctx.is_valid:
        trace_data["trace_id"] = format(span_ctx.trace_id, "x")
        trace_data["span_id"] = format(span_ctx.span_id, "x")

    dataDict: Dict[str, Any] = {
        **trace_data,
        **(
            data.model_dump(exclude_unset=True, exclude_none=True)
            if isinstance(data, BasicEvaluateData)
            else data or {}
        ),
    }

    if span:
        span.update(
            input=TypedValueJson(type="json", value=dataDict),
            params=settings,  # type: ignore
        )

    client = get_instance()

    return {
        "url": get_endpoint() + f"/api/evaluations/{slug}/evaluate",
        "json": {
            "trace_id": (
                None
                if client and client.disable_sending
                else (
                    format(span_ctx.trace_id, "x")
                    if span_ctx and span_ctx.is_valid
                    else None
                )
            ),
            "span_id": (
                None
                if client and client.disable_sending
                else (
                    format(span_ctx.span_id, "x")
                    if span_ctx and span_ctx.is_valid
                    else None
                )
            ),
            "name": name,
            "data": dataDict,
            "settings": settings,
            "as_guardrail": as_guardrail,
        },
        "headers": {"X-Auth-Token": get_api_key()},
    }


def _handle_response(
    response: Dict[str, Any],
    span: Optional["LangWatchSpan"] = None,
    as_guardrail: bool = False,
) -> EvaluationResultModel:
    """Handle API response and update span."""
    result = EvaluationResultModel.model_validate(response)
    if span:
        span.update(
            output=(
                TypedValueGuardrailResult(
                    type="guardrail_result",
                    value=cast(
                        EvaluationResult,
                        result.model_dump(exclude_unset=True, exclude_none=True),
                    ),
                )
                if as_guardrail
                else TypedValueEvaluationResult(
                    type="evaluation_result",
                    value=cast(
                        EvaluationResult,
                        result.model_dump(exclude_unset=True, exclude_none=True),
                    ),
                )
            )
        )
        if result.cost:
            span.update(
                metrics=SpanMetrics(
                    cost=result.cost.amount,
                )
            )

    return result


def _handle_exception(
    e: Exception, span: Optional["LangWatchSpan"] = None, as_guardrail: bool = False
) -> EvaluationResultModel:
    """Handle exceptions during evaluation."""
    response: Dict[str, Any] = {
        "status": "error",
        "details": repr(e),
    }
    if as_guardrail:
        response["passed"] = True
    return _handle_response(
        response,
        span,
        as_guardrail,
    )


def _add_evaluation(  # type: ignore
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
    """Add a manual evaluation result to a span."""
    if not span or not span.trace:
        raise ValueError("No span or trace found, could not add evaluation to span")

    evaluation_result = EvaluationResult(status=status)
    if passed is not None:
        evaluation_result["passed"] = passed
    if score is not None:
        evaluation_result["score"] = score
    if label is not None:
        evaluation_result["label"] = label
    if details is not None:
        evaluation_result["details"] = details
    if cost is not None:
        if isinstance(cost, Money):
            evaluation_result["cost"] = {
                "currency": cost.currency,
                "amount": cost.amount,
            }
        elif isinstance(cost, float) or isinstance(cost, int):
            evaluation_result["cost"] = {"currency": "USD", "amount": cost}
        else:
            evaluation_result["cost"] = cost

    eval_span_created = False
    eval_span = span

    if not span or span.type != "evaluation":
        eval_span = langwatch.span(
            type="evaluation", span_context=span.get_span_context() if span else None
        )
        eval_span_created = True

    try:
        eval_span.update(
            name=name,
            output=TypedValueEvaluationResult(
                type="evaluation_result",
                value=evaluation_result,
            ),
            error=error,
            timestamps=(
                SpanTimestamps(
                    started_at=(
                        timestamps["started_at"]
                        if "started_at" in timestamps and timestamps["started_at"]
                        else cast(int, None)
                    ),
                    finished_at=(
                        timestamps["finished_at"]
                        if "finished_at" in timestamps and timestamps["finished_at"]
                        else cast(int, None)
                    ),
                )
                if timestamps
                else None
            ),
        )
        if "cost" in evaluation_result and evaluation_result["cost"]:
            eval_span.update(
                metrics=SpanMetrics(cost=evaluation_result["cost"]["amount"])
            )

        span_id = None
        span_ctx = eval_span.get_span_context()
        if span_ctx and span_ctx.is_valid:
            span_id = format(span_ctx.span_id, "x")

        evaluation = _EvaluationTypedDict(
            evaluation_id=evaluation_id or str(PKSUID("eval")),
            span_id=span_id,
            name=name,
            type=type,
            is_guardrail=is_guardrail,
            status=status,
            passed=passed,
            score=score,
            label=label,
            details=details,
            error=capture_exception(error) if error else None,
            timestamps=timestamps,
        )

        span.add_event(
            AttributeKey.LangWatchEventEvaluationCustom,
            {
                "json_encoded_event": json.dumps(
                    evaluation,
                    cls=SerializableWithStringFallback,
                ),
            },
        )

    finally:
        # If the span was created by the function, we need to end it
        if eval_span_created:
            eval_span.end()


# ============================================================================
# Deprecated Backward Compatibility for Experiment API
# ============================================================================

# Deprecated aliases for old names
EvaluationRunResult = ExperimentRunResult
EvaluationRunSummary = ExperimentRunSummary
EvaluationNotFoundError = ExperimentNotFoundError
EvaluationTimeoutError = ExperimentTimeoutError
EvaluationRunFailedError = ExperimentRunFailedError
EvaluationsApiError = ExperimentsApiError

# Keep Evaluation as alias to Experiment for backward compatibility
Evaluation = _Experiment


def run(*args, **kwargs) -> ExperimentRunResult:
    """
    Deprecated: Use langwatch.experiment.run() instead.

    This function runs a platform-configured experiment.
    """
    warnings.warn(
        "langwatch.evaluation.run() is deprecated, use langwatch.experiment.run() instead",
        DeprecationWarning,
        stacklevel=2,
    )
    return _experiment_run(*args, **kwargs)


def init(name: str, *, run_id: Optional[str] = None) -> _Experiment:
    """
    Deprecated: Use langwatch.experiment.init() instead.

    This function initializes an SDK-defined experiment.
    """
    warnings.warn(
        "langwatch.evaluation.init() is deprecated, use langwatch.experiment.init() instead",
        DeprecationWarning,
        stacklevel=2,
    )
    experiment = _Experiment(name, run_id=run_id)
    experiment.init()
    return experiment


__all__ = [
    # Online Evaluation / Guardrails API (new, recommended)
    "evaluate",
    "async_evaluate",
    "BasicEvaluateData",
    "EvaluationResultModel",
    # Deprecated experiment compatibility
    "init",
    "run",
    "Evaluation",
    # Old names (deprecated)
    "EvaluationRunResult",
    "EvaluationRunSummary",
    "EvaluationNotFoundError",
    "EvaluationTimeoutError",
    "EvaluationRunFailedError",
    "EvaluationsApiError",
    # New experiment names (prefer langwatch.experiment)
    "ExperimentRunResult",
    "ExperimentRunSummary",
    "ExperimentNotFoundError",
    "ExperimentTimeoutError",
    "ExperimentRunFailedError",
    "ExperimentsApiError",
    "TargetStats",
    "EvaluatorStats",
]
