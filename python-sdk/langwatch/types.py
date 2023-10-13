from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


ChatRole = Literal["system", "user", "assistant", "function", "unknown"]


class FunctionCall(TypedDict, total=False):
    name: str
    arguments: str


class ChatMessage(TypedDict, total=False):
    role: ChatRole
    content: Optional[str]
    function_call: Optional[FunctionCall]


class TypedValueChatMessages(TypedDict):
    type: Literal["chat_messages"]
    value: List[ChatMessage]


class TypedValueText(TypedDict):
    type: Literal["text"]
    value: str


JSONSerializable = Union[str, int, float, bool, None, Dict[str, Any], List[Any]]


class TypedValueJson(TypedDict):
    type: Literal["json"]
    value: JSONSerializable


class ErrorCapture(TypedDict):
    message: str
    stacktrace: List[str]


SpanInput = Union[TypedValueText, TypedValueChatMessages, TypedValueJson]

SpanOutput = Union[TypedValueText, TypedValueChatMessages, TypedValueJson]


class SpanMetrics(TypedDict, total=False):
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]


class SpanParams(TypedDict, total=False):
    temperature: float
    stream: bool
    functions: Optional[List[Dict[str, Any]]]


class SpanTimestamps(TypedDict, total=False):
    started_at: int
    first_token_at: Optional[int]
    finished_at: int


class BaseSpan(TypedDict):
    type: Literal["span", "chain", "tool", "agent"]
    name: Optional[str]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    # TODO: inputs?
    outputs: List[SpanOutput]  # TODO?
    error: Optional[ErrorCapture]
    timestamps: SpanTimestamps


class LLMSpan(TypedDict, total=False):
    type: Literal["llm"]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    vendor: str
    model: str
    input: SpanInput
    outputs: List[SpanOutput]
    raw_response: Optional[Union[str, dict, list]]
    error: Optional[ErrorCapture]
    params: SpanParams
    metrics: SpanMetrics
    timestamps: SpanTimestamps


Span = Union[LLMSpan, BaseSpan]
