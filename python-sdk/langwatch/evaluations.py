from contextlib import contextmanager
from typing import List, Literal, Optional, Union, cast
from uuid import UUID

import httpx
from pydantic import BaseModel

import langwatch
import langwatch.tracer
from langwatch.tracer import ContextSpan, get_current_trace
from langwatch.types import (
    Conversation,
    EvaluationResult,
    RAGChunk,
    SpanTypes,
    TypedValueEvaluationResult,
    TypedValueGuardrailResult,
    TypedValueJson,
)


class Money(BaseModel):
    currency: str
    amount: float


class EvaluationResultModel(BaseModel):
    status: Literal["processed", "skipped", "error"]
    passed: Optional[bool] = None
    score: Optional[float] = None
    details: Optional[str] = None
    label: Optional[str] = None
    cost: Optional[Money] = None


def evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
    as_guardrail: bool = False,
):
    with _optional_create_span(
        name=slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = prepare_data(
            slug,
            input,
            output,
            contexts,
            conversation,
            settings=settings,
            trace_id=span.trace.trace_id if span and span.trace else None,
            span_id=span.span_id if span else None,
            span=span,
            as_guardrail=as_guardrail,
        )
        try:
            with httpx.Client() as client:
                response = client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return handle_exception(e, span, as_guardrail)

        return handle_response(response.json(), span, as_guardrail)


async def async_evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
    as_guardrail: bool = False,
):
    with _optional_create_span(
        name=slug, type="guardrail" if as_guardrail else "evaluation"
    ) as span:
        request_params = prepare_data(
            slug,
            input,
            output,
            contexts,
            conversation,
            settings=settings,
            trace_id=span.trace.trace_id if span and span.trace else None,
            span_id=span.span_id if span else None,
            span=span,
            as_guardrail=as_guardrail,
        )
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return handle_exception(e, span, as_guardrail)

        return handle_response(response.json(), span, as_guardrail)


@contextmanager
def _optional_create_span(name: str, type: SpanTypes):
    trace = None
    try:
        trace = get_current_trace()
    except:
        pass
    if trace:
        with trace.span(name=name, type=type) as span:
            yield span
    else:
        yield None


def prepare_data(
    slug: str,
    input: Optional[str],
    output: Optional[str],
    contexts: List[RAGChunk],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
    trace_id: Optional[Union[str, UUID]] = None,
    span_id: Optional[Union[str, UUID]] = None,
    span: Optional[ContextSpan] = None,
    as_guardrail: bool = False,
):
    data = {}
    if input:
        data["input"] = input
    if output:
        data["output"] = output
    if contexts and len(contexts) > 0:
        data["contexts"] = contexts
    if conversation and len(conversation) > 0:
        data["conversation"] = conversation
    if span:
        span.update(input=TypedValueJson(type="json", value=data))

    return {
        "url": langwatch.endpoint + f"/api/evaluations/{slug}/evaluate",
        "json": {
            "trace_id": str(trace_id) if trace_id else None,
            "span_id": str(span_id) if span_id else None,
            "data": data,
            "settings": settings,
            "as_guardrail": as_guardrail,
        },
        "headers": {"X-Auth-Token": str(langwatch.api_key)},
    }


def handle_response(
    response: dict,
    span: Optional[ContextSpan] = None,
    as_guardrail: bool = False,
):
    result = EvaluationResultModel.model_validate(response)
    if result.status == "error":
        result.details = response.get("message", "")
    if span:
        span.update(
            output=TypedValueGuardrailResult(
                type="guardrail_result",
                value=cast(EvaluationResult, result.model_dump()),
            ) if as_guardrail else TypedValueEvaluationResult(
                type="evaluation_result",
                value=cast(EvaluationResult, result.model_dump()),
            )
        )
    return result


def handle_exception(
    e: Exception, span: Optional[ContextSpan] = None, as_guardrail: bool = False
):
    response: dict = {
        "status": "error",
        "message": str(e),
    }
    if as_guardrail:
        response["passed"] = True
    return handle_response(
        response,
        span,
        as_guardrail,
    )
