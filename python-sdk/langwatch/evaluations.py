from contextlib import contextmanager
from typing import List, Literal, Optional, Union, cast
from typing_extensions import TypedDict
from warnings import warn

import httpx
from pydantic import BaseModel

import langwatch
import langwatch.tracer
from langwatch.tracer import ContextSpan, get_current_trace
from langwatch.types import (
    Conversation,
    EvaluationResult,
    RAGChunk,
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
):
    request_params = prepare_data(slug, input, output, contexts, conversation, settings)
    try:
        with httpx.Client() as client:
            response = client.post(**request_params)
            response.raise_for_status()
    except Exception as e:
        return handle_response(
            {
                "status": "error",
                "message": str(e),
            },
        )

    return handle_response(response.json())


async def async_evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
):
    request_params = prepare_data(slug, input, output, contexts, conversation, settings)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(**request_params)
            response.raise_for_status()
    except Exception as e:
        return handle_response(
            {
                "status": "error",
                "message": str(e),
            },
        )

    return handle_response(response.json())


def prepare_data(
    slug: str,
    input: Optional[str],
    output: Optional[str],
    contexts: List[RAGChunk],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
    span: Optional[ContextSpan] = None,
    as_guardrail: bool = False,
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
    if conversation and len(conversation) > 0:
        data["conversation"] = conversation
    if span:
        span.update(input=TypedValueJson(type="json", value=data))

    return {
        "url": langwatch.endpoint + f"/api/evaluations/{slug}/evaluate",
        "json": {
            "trace_id": trace.trace_id if trace else None,
            "data": data,
            "settings": settings,
            "as_guardrail": as_guardrail,
        },
        "headers": {"X-Auth-Token": str(langwatch.api_key)},
    }


def handle_response(
    response: dict,
    span: Optional[ContextSpan] = None,
):
    result = EvaluationResultModel.model_validate(response)
    if result.status == "error":
        result.details = response.get("message", "")
    if span:
        span.update(
            output=TypedValueGuardrailResult(
                type="guardrail_result",
                value=cast(EvaluationResult, result.model_dump()),
            )
        )
    return result
