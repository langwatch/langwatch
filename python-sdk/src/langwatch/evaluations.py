import json
from typing import Any, Dict, List, Literal, Optional, Union, cast, TYPE_CHECKING
from uuid import UUID
from warnings import warn
from deprecated import deprecated

import httpx
import langwatch
from langwatch.domain import SpanTimestamps
import nanoid
from langwatch.telemetry.span import LangWatchSpan
from langwatch.telemetry.context import get_current_span
from langwatch.state import get_api_key, get_endpoint, get_instance
from langwatch.attributes import AttributeKey
from pydantic import BaseModel

from langwatch.types import (
    Conversation,
    Evaluation,
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

if TYPE_CHECKING:
    from langwatch.telemetry.tracing import LangWatchTrace


class BasicEvaluateData(BaseModel):
    input: Optional[str] = None
    output: Optional[str] = None
    expected_output: Optional[str] = None
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None
    conversation: Optional[Conversation] = None


class EvaluationResultModel(BaseModel):
    status: Literal["processed", "skipped", "error"]
    passed: Optional[bool] = None
    score: Optional[float] = None
    details: Optional[str] = None
    label: Optional[str] = None
    cost: Optional[Money] = None
    error_type: Optional[str] = None


@deprecated(
    reason="Please use the new `langwatch.evaluation` module instead. TODO: Link to migration guide"
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
) -> EvaluationResultModel:  # type: ignore
    if trace:
        warn(
            "The `trace` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Supplying this argument will have no effect. Please use the `span` argument instead.",
            stacklevel=2,
        )

    with langwatch.span(
        name=name or slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = _prepare_data(
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            expected_contexts=expected_contexts,
            conversation=conversation,
            settings=settings,
            span=span,
            as_guardrail=as_guardrail,
            api_key=api_key,
            data=data,
        )
        try:
            with httpx.Client(timeout=900) as client:
                response = client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return _handle_exception(e, span, as_guardrail)

        return _handle_response(response.json(), span, as_guardrail)

    raise ValueError("Evaluate failed due to issue creating span")


@deprecated(
    reason="Please use the new `langwatch.evaluation` module instead. TODO: Link to migration guide"
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
) -> EvaluationResultModel:  # type: ignore
    if trace:
        warn(
            "The `trace` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Supplying this argument will have no effect. Please use the `span` argument instead.",
            stacklevel=2,
        )

    with langwatch.span(
        name=name or slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = _prepare_data(
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            expected_contexts=expected_contexts,
            conversation=conversation,
            settings=settings,
            span=span,
            as_guardrail=as_guardrail,
            api_key=api_key,
            data=data,
        )
        try:
            async with httpx.AsyncClient(timeout=900) as client:
                response = await client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return _handle_exception(e, span, as_guardrail)

        return _handle_response(response.json(), span, as_guardrail)

    raise ValueError("Async evaluate failed due to issue creating span")


def _prepare_data(
    slug: str,
    name: Optional[str],
    input: Optional[str],
    output: Optional[str],
    expected_output: Optional[str],
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    conversation: Optional[Conversation] = None,
    settings: Optional[Dict[str, Any]] = None,
    trace_id: Optional[Union[str, UUID]] = None,
    span_id: Optional[Union[str, UUID]] = None,
    span: Optional["LangWatchSpan"] = None,
    as_guardrail: bool = False,
    api_key: Optional[str] = None,
    data: Optional[Union[BasicEvaluateData, Dict[str, Any]]] = None,
):
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
    if input is not None:
        warn(
            "For the `evaluate` or `async_evaluate` function, the `input` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Please use the `data` argument instead, you can use the `input` key in the `data` argument, or use the helper class `BasicEvaluateData`.",
            stacklevel=2,
        )
        dataDict["input"] = input
    if output is not None:
        warn(
            "For the `evaluate` or `async_evaluate` function, the `output` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Please use the `data` argument instead, you can use the `output` key in the `data` argument, or use the helper class `BasicEvaluateData`.",
            stacklevel=2,
        )
        dataDict["output"] = output
    if expected_output is not None:
        warn(
            "For the `evaluate` or `async_evaluate` function, the `expected_output` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Please use the `data` argument instead, you can use the `expected_output` key in the `data` argument, or use the helper class `BasicEvaluateData`.",
            stacklevel=2,
        )
        dataDict["expected_output"] = expected_output
    if contexts is not None:
        warn(
            "For the `evaluate` or `async_evaluate` function, the `contexts` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Please use the `data` argument instead, you can use the `contexts` key in the `data` argument, or use the helper class `BasicEvaluateData`.",
            stacklevel=2,
        )
        dataDict["contexts"] = contexts
    if expected_contexts is not None:
        warn(
            "For the `evaluate` or `async_evaluate` function, the `expected_contexts` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Please use the `data` argument instead, you can use the `expected_contexts` key in the `data` argument, or use the helper class `BasicEvaluateData`.",
            stacklevel=2,
        )
        dataDict["expected_contexts"] = expected_contexts
    if conversation is not None:
        warn(
            "For the `evaluate` or `async_evaluate` function, the `conversation` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Please use the `data` argument instead, you can use the `conversation` key in the `data` argument, or use the helper class `BasicEvaluateData`.",
            stacklevel=2,
        )
        dataDict["conversation"] = conversation

    if trace_id is not None:
        warn(
            "The `trace_id` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `trace_id` will be mapped to `deprecated.trace_id` in the data.",
            stacklevel=2,
        )
        dataDict["deprecated.trace_id"] = str(trace_id)
    if span_id is not None:
        warn(
            "The `span_id` argument is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the data.",
            stacklevel=2,
        )
        dataDict["deprecated.span_id"] = str(span_id)

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
) -> EvaluationResult:
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
):
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


@deprecated(
    reason="Please use the new `langwatch.evaluation` module instead. TODO: Link to migration guide"
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

        evaluation = Evaluation(
            evaluation_id=evaluation_id or f"eval_{nanoid.generate()}",
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
