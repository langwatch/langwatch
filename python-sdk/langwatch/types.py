from typing import List, Literal, Optional, TypedDict, Union


class TypedValueText(TypedDict):
    type: Literal["text"]
    value: str


ChatRole = Literal["system", "user", "assistant", "function", "unknown"]


class ChatMessage(TypedDict, total=False):
    role: ChatRole
    content: str
    name: Optional[str]


class TypedValueChatMessages(TypedDict):
    type: Literal["chat_messages"]
    value: List[ChatMessage]


class ErrorCapture(TypedDict):
    message: str
    stacktrace: List[str]


SpanInput = Union[TypedValueText, TypedValueChatMessages]

SpanOutput = Union[TypedValueText, TypedValueChatMessages]


class SpanMetrics(TypedDict, total=False):
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]


class SpanParams(TypedDict, total=False):
    temperature: float
    stream: bool


class SpanTimestamps(TypedDict, total=False):
    started_at: int
    first_token_at: Optional[int]
    finished_at: int


class BaseSpan(TypedDict):
    type: Literal["span", "chain"]
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
