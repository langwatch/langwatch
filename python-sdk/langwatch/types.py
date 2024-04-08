from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


ChatRole = Literal[
    "system", "user", "assistant", "function", "tool", "guardrail", "unknown"
]


class FunctionCall(TypedDict, total=False):
    name: str
    arguments: str


class ToolCall(TypedDict):
    id: str
    type: str
    function: FunctionCall


class ChatMessage(TypedDict, total=False):
    role: ChatRole
    content: Optional[str]
    function_call: Optional[FunctionCall]
    tool_calls: Optional[List[ToolCall]]


class TypedValueChatMessages(TypedDict):
    type: Literal["chat_messages"]
    value: List[ChatMessage]


class TypedValueText(TypedDict):
    type: Literal["text"]
    value: str


class GuardrailResult(TypedDict, total=False):
    status: Literal["processed", "skipped", "error"]
    passed: bool
    score: Optional[float]
    details: Optional[str]


class TypedValueGuardrailResult(TypedDict):
    type: Literal["guardrail_result"]
    value: GuardrailResult


class TypedValueRaw(TypedDict):
    type: Literal["raw"]
    value: str


JSONSerializable = Union[str, int, float, bool, None, Dict[str, Any], List[Any]]


class TypedValueJson(TypedDict):
    type: Literal["json"]
    value: JSONSerializable


class ErrorCapture(TypedDict):
    message: str
    stacktrace: List[str]


SpanInputOutput = Union[
    TypedValueText,
    TypedValueChatMessages,
    TypedValueJson,
    TypedValueGuardrailResult,
    TypedValueRaw,
]


class SpanMetrics(TypedDict, total=False):
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]


class SpanParams(TypedDict, total=False):
    temperature: float
    stream: bool
    functions: Optional[List[Dict[str, Any]]]
    tools: Optional[List[Dict[str, Any]]]
    tool_choice: Optional[str]


class SpanTimestamps(TypedDict, total=False):
    started_at: int
    first_token_at: Optional[int]
    finished_at: int


SpanTypes = Literal["span", "llm", "chain", "tool", "agent", "guardrail", "rag"]


class BaseSpan(TypedDict):
    type: SpanTypes
    name: Optional[str]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    input: Optional[SpanInputOutput]
    outputs: List[SpanInputOutput]
    error: Optional[ErrorCapture]
    metrics: Optional[SpanMetrics]
    timestamps: SpanTimestamps


class LLMSpan(TypedDict, total=False):
    type: Literal["llm"]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    vendor: str
    model: str
    input: SpanInputOutput
    outputs: List[SpanInputOutput]
    error: Optional[ErrorCapture]
    params: SpanParams
    metrics: Optional[SpanMetrics]
    timestamps: SpanTimestamps


class RAGChunk(TypedDict, total=False):
    document_id: str
    chunk_id: Optional[str]
    content: Union[str, dict, list]


class RAGSpan(TypedDict, total=False):
    type: Literal["rag"]
    name: Optional[str]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    input: Optional[SpanInputOutput]
    outputs: List[SpanInputOutput]
    error: Optional[ErrorCapture]
    metrics: Optional[SpanMetrics]
    timestamps: SpanTimestamps
    contexts: List[RAGChunk]


Span = Union[LLMSpan, RAGSpan, BaseSpan]


class Experiment(TypedDict):
    experiment_id: str
    variant: int


class TraceMetadata(TypedDict, total=False):
    user_id: Optional[str]
    thread_id: Optional[str]
    customer_id: Optional[str]
    labels: List[str]
    experiments: List[Experiment]


class CollectorRESTParams(TypedDict):
    trace_id: str
    metadata: Optional[TraceMetadata]
    spans: List[Span]
