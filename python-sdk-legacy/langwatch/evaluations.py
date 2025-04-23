from contextlib import contextmanager
from typing import List, Literal, Optional, Union, cast
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict

import langwatch
import langwatch.tracer
from langwatch.tracer import ContextSpan, ContextTrace, get_current_trace
from langwatch.types import (
    Conversation,
    EvaluationResult,
    Money,
    SpanMetrics,
    RAGChunk,
    SpanTypes,
    TypedValueEvaluationResult,
    TypedValueGuardrailResult,
    TypedValueJson,
)


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
    trace: Optional[ContextTrace] = None,
    span: Optional[ContextSpan] = None,
    api_key: Optional[str] = None,
):
    with _optional_create_span(
        trace=trace,
        span=span,
        name=name or slug,
        type="guardrail" if as_guardrail else "evaluation",
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
            trace_id=span.trace.trace_id if span and span.trace else None,
            span_id=span.span_id if span else None,
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
    trace: Optional[ContextTrace] = None,
    span: Optional[ContextSpan] = None,
    api_key: Optional[str] = None,
):
    with _optional_create_span(
        trace=trace,
        span=span,
        name=name or slug,
        type="guardrail" if as_guardrail else "evaluation",
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
            trace_id=span.trace.trace_id if span and span.trace else None,
            span_id=span.span_id if span else None,
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


@contextmanager
def _optional_create_span(
    trace: Optional[ContextTrace],
    span: Optional[ContextSpan],
    name: str,
    type: SpanTypes,
):
    trace_or_span = None
    if span:
        trace_or_span = span
    elif trace:
        trace_or_span = trace
    else:
        try:
            trace_or_span = get_current_trace()
        except:
            pass

    if trace_or_span:
        with trace_or_span.span(name=name, type=type) as span:
            yield span
    else:
        yield None


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
    span: Optional[ContextSpan] = None,
    as_guardrail: bool = False,
    api_key: Optional[str] = None,
):
    data = {}
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
    if span:
        span.update(
            input=TypedValueJson(type="json", value=data),
            params=settings,  # type: ignore
        )

    return {
        "url": langwatch.endpoint + f"/api/evaluations/{slug}/evaluate",
        "json": {
            "trace_id": str(trace_id) if trace_id else None,
            "span_id": str(span_id) if span_id else None,
            "name": name,
            "data": data,
            "settings": settings,
            "as_guardrail": as_guardrail,
        },
        "headers": {"X-Auth-Token": str(api_key or langwatch.api_key)},
    }


def handle_response(
    response: dict,
    span: Optional[ContextSpan] = None,
    as_guardrail: bool = False,
):
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
    e: Exception, span: Optional[ContextSpan] = None, as_guardrail: bool = False
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
