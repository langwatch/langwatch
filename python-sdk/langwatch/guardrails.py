from contextlib import contextmanager
from typing import List, Literal, Optional, Union, cast
from warnings import warn

import httpx
from pydantic import BaseModel

import langwatch
import langwatch.tracer
from langwatch.tracer import ContextSpan, get_current_trace
from langwatch.types import (
    GuardrailResult,
    RAGChunk,
    SpanTypes,
    TypedValueGuardrailResult,
    TypedValueJson,
)


class Money(BaseModel):
    currency: str
    amount: float


class GuardrailResultModel(BaseModel):
    status: Literal["processed", "skipped", "error"]
    passed: bool = True
    score: Optional[float] = None
    details: Optional[str] = None
    cost: Optional[Money] = None


def evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
):
    with _optional_create_span(name=slug, type="guardrail") as span:
        request_params = prepare_data(slug, input, output, contexts, span=span)
        try:
            with httpx.Client() as client:
                response = client.post(**request_params)
                response.raise_for_status()
        except Exception as e:
            return handle_response(
                {
                    "status": "error",
                    "message": str(e),
                    "passed": True,
                },
                span,
            )

        return handle_response(response.json(), span)


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


async def async_evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
):
    trace = None
    try:
        trace = get_current_trace()
    except:
        pass

    span = trace.span(name=slug, type="guardrail") if trace else None

    request_params = prepare_data(slug, input, output, contexts, span=span)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(**request_params)
            response.raise_for_status()
    except Exception as e:
        return handle_response(
            {
                "status": "error",
                "message": str(e),
                "passed": True,
            },
            span,
        )

    response = handle_response(response.json(), span)

    if span:
        span.end()

    return response


def prepare_data(
    slug: str,
    input: Optional[str],
    output: Optional[str],
    contexts: List[RAGChunk],
    span: Optional[ContextSpan],
):
    try:
        trace = get_current_trace()
    except:
        trace = None
    data = {}
    if input:
        data["input"] = input
    if output:
        data["output"] = output
    if contexts and len(contexts) > 0:
        data["contexts"] = contexts
    if span:
        span.update(input=TypedValueJson(type="json", value=data))

    return {
        "url": langwatch.endpoint + f"/api/guardrails/{slug}/evaluate",
        "json": {
            "trace_id": trace.trace_id if trace else None,
            "data": data,
        },
        "headers": {"X-Auth-Token": str(langwatch.api_key)},
    }


def handle_response(
    response: dict,
    span: Optional[ContextSpan],
):
    result = GuardrailResultModel.model_validate(response)
    if result.status == "error":
        result.details = response.get("message", "")
    if span:
        span.update(
            output=TypedValueGuardrailResult(
                type="guardrail_result",
                value=cast(GuardrailResult, result.model_dump()),
            )
        )
    return result
