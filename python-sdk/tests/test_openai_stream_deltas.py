"""Delta accumulation for streamed chat completions.

api.openai.com opens every stream with a role-carrying delta, but
OpenAI-compatible backends (the LangWatch AI Gateway among them) can send
the first delta already carrying content or tool calls. handle_deltas must
accumulate both shapes identically instead of assuming the role delta
always arrives first.
"""

from typing import Any, Dict, List, Optional

from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import (
    Choice,
    ChoiceDelta,
    ChoiceDeltaToolCall,
    ChoiceDeltaToolCallFunction,
)

from langwatch.openai import OpenAIChatCompletionTracer
from langwatch.domain import SpanTimestamps


def chunk(
    *,
    role: Optional[str] = None,
    content: Optional[str] = None,
    tool_calls: Optional[List[ChoiceDeltaToolCall]] = None,
    index: int = 0,
) -> ChatCompletionChunk:
    return ChatCompletionChunk(
        id="chatcmpl-test",
        object="chat.completion.chunk",
        created=1,
        model="gpt-5-mini",
        choices=[
            Choice(
                index=index,
                delta=ChoiceDelta(role=role, content=content, tool_calls=tool_calls),  # type: ignore[arg-type]
                finish_reason=None,
            )
        ],
    )


def accumulate(deltas: List[ChatCompletionChunk]) -> List[List[Dict[str, Any]]]:
    captured: List[List[Dict[str, Any]]] = []

    original_end_span = OpenAIChatCompletionTracer.end_span

    def capture_end_span(client, span, outputs, metrics, timestamps, **kwargs):
        captured.append([dict(o["value"][0]) for o in outputs])  # type: ignore[index]

    OpenAIChatCompletionTracer.end_span = classmethod(  # type: ignore[assignment]
        lambda cls, client, span, outputs, metrics, timestamps, **kwargs: capture_end_span(
            client, span, outputs, metrics, timestamps, **kwargs
        )
    )
    try:
        OpenAIChatCompletionTracer.handle_deltas(
            client=None,  # type: ignore[arg-type]
            span=None,  # type: ignore[arg-type]
            deltas=deltas,
            timestamps=SpanTimestamps(started_at=0, finished_at=1),
        )
    finally:
        OpenAIChatCompletionTracer.end_span = original_end_span  # type: ignore[assignment]

    assert len(captured) == 1
    return captured


def test_role_first_stream_accumulates_content():
    outputs = accumulate(
        [
            chunk(role="assistant", content=""),
            chunk(content="Hello"),
            chunk(content=" world"),
        ]
    )
    assert outputs[0][0]["role"] == "assistant"
    assert outputs[0][0]["content"] == "Hello world"


def test_roleless_stream_accumulates_content():
    outputs = accumulate(
        [
            chunk(content="Hello"),
            chunk(content=" world"),
        ]
    )
    assert outputs[0][0]["role"] == "assistant"
    assert outputs[0][0]["content"] == "Hello world"


def test_roleless_stream_accumulates_tool_calls():
    outputs = accumulate(
        [
            chunk(
                tool_calls=[
                    ChoiceDeltaToolCall(
                        index=0,
                        id="call_1",
                        type="function",
                        function=ChoiceDeltaToolCallFunction(
                            name="get_weather", arguments='{"city":'
                        ),
                    )
                ]
            ),
            chunk(
                tool_calls=[
                    ChoiceDeltaToolCall(
                        index=0,
                        function=ChoiceDeltaToolCallFunction(arguments='"Paris"}'),
                    )
                ]
            ),
        ]
    )
    tool_calls = outputs[0][0]["tool_calls"]
    assert tool_calls[0]["function"]["name"] == "get_weather"
    assert tool_calls[0]["function"]["arguments"] == '{"city":"Paris"}'


def test_empty_first_delta_then_content():
    outputs = accumulate(
        [
            chunk(),
            chunk(content="Hi"),
        ]
    )
    assert outputs[0][0]["role"] == "assistant"
    assert outputs[0][0]["content"] == "Hi"
