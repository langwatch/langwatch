"""Delta accumulation for streamed litellm chat completions.

Tool-call names, ids and types can arrive after the first delta, and
parallel tool calls open index 1+ mid-stream. handle_deltas must merge
every fragment by tool index.
"""

from typing import Any, Dict, List, Optional

from litellm.types.utils import (
    ChatCompletionDeltaToolCall,
    Delta,
    Function,
    ModelResponse,
    ModelResponseStream,
    StreamingChoices,
)

from langwatch.domain import SpanTimestamps
from langwatch.litellm import LiteLLMPatch


def tool(
    index: int,
    *,
    id: Optional[str] = None,
    name: Optional[str] = None,
    arguments: Optional[str] = None,
) -> ChatCompletionDeltaToolCall:
    return ChatCompletionDeltaToolCall(
        id=id,
        type="function" if id else None,
        index=index,
        function=Function(name=name, arguments=arguments),
    )


def chunk(
    *,
    role: Optional[str] = None,
    content: Optional[str] = None,
    tool_calls: Optional[List[ChatCompletionDeltaToolCall]] = None,
) -> ModelResponse:
    choice = StreamingChoices(index=0, finish_reason=None)
    choice.delta = Delta(role=role, content=content, tool_calls=tool_calls)
    return ModelResponseStream(choices=[choice])  # type: ignore[return-value]


def accumulate(deltas: List[ModelResponse]) -> Dict[str, Any]:
    captured: List[Any] = []
    original_end_span = LiteLLMPatch.end_span
    LiteLLMPatch.end_span = classmethod(  # type: ignore[assignment]
        lambda cls, span, outputs, **kwargs: captured.append(outputs)
    )
    try:
        LiteLLMPatch.handle_deltas(
            span=None,  # type: ignore[arg-type]
            deltas=deltas,
            timestamps=SpanTimestamps(started_at=0, finished_at=1),
        )
    finally:
        LiteLLMPatch.end_span = original_end_span  # type: ignore[assignment]
    return dict(captured[0][0]["value"][0])


def test_role_delta_without_tool_name_keeps_later_name_and_id():
    message = accumulate(
        [
            chunk(role="assistant", tool_calls=[tool(0)]),
            chunk(tool_calls=[tool(0, id="call_1", name="get_weather", arguments="{")]),
            chunk(tool_calls=[tool(0, arguments='"a":1}')]),
        ]
    )
    (call,) = message["tool_calls"]
    assert call["id"] == "call_1"
    assert call["type"] == "function"
    assert call["function"] == {"name": "get_weather", "arguments": '{"a":1}'}


def test_parallel_tool_calls_opened_mid_stream():
    message = accumulate(
        [
            chunk(
                role="assistant",
                tool_calls=[tool(0, id="call_1", name="a", arguments="{}")],
            ),
            chunk(tool_calls=[tool(1, id="call_2", name="b", arguments="{")]),
            chunk(tool_calls=[tool(1, arguments="}")]),
        ]
    )
    names = [c["function"]["name"] for c in message["tool_calls"]]
    args = [c["function"]["arguments"] for c in message["tool_calls"]]
    assert names == ["a", "b"]
    assert args == ["{}", "{}"]
