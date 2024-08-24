from typing import Any, Dict, List, Literal, Optional, Union
from typing_extensions import TypedDict


ChatRole = Literal[
    "system",
    "user",
    "assistant",
    "function",
    "tool",
    "guardrail",
    "evaluation",
    "unknown",
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
    tool_call_id: Optional[str]
    name: Optional[str]


class TypedValueChatMessages(TypedDict):
    type: Literal["chat_messages"]
    value: List[ChatMessage]


class TypedValueText(TypedDict):
    type: Literal["text"]
    value: str


class TypedValueList(TypedDict):
    type: Literal["list"]
    value: List["SpanInputOutput"]


class EvaluationResult(TypedDict, total=False):
    status: Literal["processed", "skipped", "error"]
    passed: Optional[bool]
    score: Optional[float]
    details: Optional[str]
    label: Optional[str]


class ConversationEntry(TypedDict):
    input: str
    output: str


Conversation = List[ConversationEntry]


class TypedValueGuardrailResult(TypedDict):
    type: Literal["guardrail_result"]
    value: EvaluationResult


class TypedValueEvaluationResult(TypedDict):
    type: Literal["evaluation_result"]
    value: EvaluationResult


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
    TypedValueEvaluationResult,
    TypedValueRaw,
    TypedValueList,
]


class SpanTimestamps(TypedDict, total=False):
    started_at: int
    first_token_at: Optional[int]
    finished_at: int


SpanTypes = Literal[
    "span",
    "llm",
    "chain",
    "tool",
    "agent",
    "guardrail",
    "evaluation",
    "rag",
    "workflow",
    "component",
    "server",
    "client",
    "producer",
    "consumer",
    "task",
    "unknown",
]


class SpanMetrics(TypedDict, total=False):
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    cost: Optional[float]


class SpanParams(TypedDict, total=False):
    frequency_penalty: Optional[float]
    logit_bias: Optional[Dict[str, float]]
    logprobs: Optional[bool]
    top_logprobs: Optional[int]
    max_tokens: Optional[int]
    n: Optional[int]
    presence_penalty: Optional[float]
    seed: Optional[int]
    stop: Optional[Union[str, List[str]]]
    stream: Optional[bool]
    temperature: Optional[float]
    top_p: Optional[float]
    tools: Optional[List[Dict[str, Any]]]
    tool_choice: Optional[str]
    parallel_tool_calls: Optional[bool]
    functions: Optional[List[Dict[str, Any]]]
    user: Optional[str]


class BaseSpan(TypedDict):
    type: SpanTypes
    name: Optional[str]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    input: Optional[SpanInputOutput]
    output: Optional[SpanInputOutput]
    error: Optional[ErrorCapture]
    timestamps: SpanTimestamps
    params: Optional[SpanParams]
    metrics: Optional[SpanMetrics]


class LLMSpan(TypedDict, total=False):
    type: Literal["llm"]
    name: Optional[str]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    input: Optional[SpanInputOutput]
    output: Optional[SpanInputOutput]
    error: Optional[ErrorCapture]
    timestamps: SpanTimestamps
    model: Optional[str]
    params: Optional[SpanParams]
    metrics: Optional[SpanMetrics]


class RAGChunk(TypedDict, total=False):
    document_id: Optional[str]
    chunk_id: Optional[str]
    content: Union[str, dict, list]


class RAGSpan(TypedDict, total=False):
    type: Literal["rag"]
    name: Optional[str]
    span_id: str
    parent_id: Optional[str]
    trace_id: str
    input: Optional[SpanInputOutput]
    output: Optional[SpanInputOutput]
    error: Optional[ErrorCapture]
    timestamps: SpanTimestamps
    contexts: List[RAGChunk]
    params: Optional[SpanParams]
    metrics: Optional[SpanMetrics]


Span = Union[LLMSpan, RAGSpan, BaseSpan]


PrimitiveType = Union[str, int, float, bool, None]

MetadataValue = Union[
    PrimitiveType,
    List[PrimitiveType],
    Dict[str, PrimitiveType],
    Dict[str, Dict[str, PrimitiveType]],  # Allow up to 2 levels of nesting
]

TraceMetadata = Dict[str, MetadataValue]


class EvaluationTimestamps(TypedDict, total=False):
    started_at: int
    finished_at: int


class Evaluation(TypedDict, total=False):
    evaluation_id: Optional[str]
    evaluator_id: Optional[str]
    span_id: Optional[str]
    name: str
    type: Optional[str]
    is_guardrail: Optional[bool]
    status: Literal["processed", "skipped", "error"]
    passed: Optional[bool]
    score: Optional[float]
    label: Optional[str]
    details: Optional[str]
    error: Optional[ErrorCapture]
    timestamps: Optional[EvaluationTimestamps]


class CollectorRESTParams(TypedDict):
    trace_id: str
    metadata: Optional[TraceMetadata]
    spans: List[Span]
    expected_output: Optional[str]
    evaluations: Optional[List[Evaluation]]
