from typing import List, Literal, Optional, Union, cast, TYPE_CHECKING
from uuid import UUID
from warnings import warn

import httpx
import langwatch
from langwatch.domain import SpanTimestamps
import nanoid
from langwatch.telemetry.span import LangWatchSpan, get_current_span
from langwatch.state import get_api_key, get_endpoint
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

if TYPE_CHECKING:
    from langwatch.telemetry.tracing import LangWatchTrace


class EvaluationResultModel(BaseModel):
    status: Literal["processed", "skipped", "error"]
    passed: Optional[bool] = None
    score: Optional[float] = None
    details: Optional[str] = None
    label: Optional[str] = None
    cost: Optional[Money] = None
    error_type: Optional[str] = None


def evaluate(
    slug: str,
    name: Optional[str] = None,
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    conversation: Optional[Conversation] = None,
    settings: Optional[dict] = None,
    as_guardrail: bool = False,
    trace: Optional["LangWatchTrace"] = None,
    span: Optional["LangWatchSpan"] = None,
    api_key: Optional[str] = None,
) -> EvaluationResultModel:  # type: ignore
    with langwatch.span(
        name=name or slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = prepare_data(
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
        )
        try:
            with httpx.Client(timeout=900) as client:
                response = client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return handle_exception(e, span, as_guardrail)

        return handle_response(response.json(), span, as_guardrail)


async def async_evaluate(
    slug: str,
    name: Optional[str] = None,
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    conversation: Optional[Conversation] = None,
    settings: Optional[dict] = None,
    as_guardrail: bool = False,
    trace: Optional["LangWatchTrace"] = None,
    span: Optional["LangWatchSpan"] = None,
    api_key: Optional[str] = None,
) -> EvaluationResultModel:  # type: ignore
    with langwatch.span(
        name=name or slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = prepare_data(
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
        )
        try:
            async with httpx.AsyncClient(timeout=900) as client:
                response = await client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return handle_exception(e, span, as_guardrail)

        return handle_response(response.json(), span, as_guardrail)


def prepare_data(
    slug: str,
    name: Optional[str],
    input: Optional[str],
    output: Optional[str],
    expected_output: Optional[str],
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    expected_contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    conversation: Optional[Conversation] = None,
    settings: Optional[dict] = None,
    trace_id: Optional[Union[str, UUID]] = None,
    span_id: Optional[Union[str, UUID]] = None,
    span: Optional["LangWatchSpan"] = None,
    as_guardrail: bool = False,
    api_key: Optional[str] = None,
):
    span_ctx = get_current_span().get_span_context()

    data = {
        "trace_id": format(span_ctx.trace_id, "x"),
        "span_id": format(span_ctx.span_id, "x"),
    }
    if input is not None:
        data["input"] = input
    if output is not None:
        data["output"] = output
    if expected_output is not None:
        data["expected_output"] = expected_output
    if contexts is not None:
        data["contexts"] = contexts
    if expected_contexts is not None:
        data["expected_contexts"] = expected_contexts
    if conversation is not None:
        data["conversation"] = conversation
    if trace_id is not None:
        warn(
            "trace_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `trace_id` will be mapped to `deprecated.trace_id` in the data."
        )
        data["deprecated.trace_id"] = trace_id
    if span_id is not None:
        warn(
            "span_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `span_id` will be mapped to `deprecated.span_id` in the data."
        )
        data["deprecated.span_id"] = span_id
    if span:
        span.update(
            input=TypedValueJson(type="json", value=data),
            params=settings,  # type: ignore
        )

    return {
        "url": get_endpoint() + f"/api/evaluations/{slug}/evaluate",
        "json": {
            "trace_id": format(span_ctx.trace_id, "x"),
            "span_id": format(span_ctx.span_id, "x"),
            "name": name,
            "data": data,
            "settings": settings,
            "as_guardrail": as_guardrail,
        },
        "headers": {"X-Auth-Token": get_api_key()},
    }


def handle_response(
    response: dict,
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


def handle_exception(
    e: Exception, span: Optional["LangWatchSpan"] = None, as_guardrail: bool = False
):
    response: dict = {
        "status": "error",
        "details": repr(e),
    }
    if as_guardrail:
        response["passed"] = True
    return handle_response(
        response,
        span,
        as_guardrail,
    )


def add_evaluation(
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

    evaluation_result = EvaluationResult(
        status=status,
    )
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

    ns = None
    if span.type != "evaluation":
        ns = span.span(type="evaluation")

    (ns or span).update(
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
        (ns or span).update(
            metrics=SpanMetrics(cost=evaluation_result["cost"]["amount"])
        )

    evaluation = Evaluation(
        evaluation_id=evaluation_id or f"eval_{nanoid.generate()}",
        span_id=(
            format((ns or span)._span.get_span_context().span_id, "x")
            if (ns or span)
            else None
        ),
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

    current_evaluation_index = [
        i
        for i, e in enumerate((ns or span).trace.evaluations)
        if evaluation_id
        and "evaluation_id" in e
        and e["evaluation_id"] == evaluation_id
    ]
    current_evaluation_index = (
        current_evaluation_index[0] if len(current_evaluation_index) > 0 else None
    )
    current_evaluation = (
        (ns or span).trace.evaluations[current_evaluation_index]
        if current_evaluation_index is not None
        else None
    )

    if current_evaluation and current_evaluation_index is not None:
        (ns or span).trace.evaluations[current_evaluation_index] = (
            current_evaluation | evaluation
        )
    else:
        (ns or span).trace.evaluations.append(evaluation)

    (ns or span).end()
