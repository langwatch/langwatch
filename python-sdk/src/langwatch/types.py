"""Common types and protocols for LangWatch."""

from typing import Protocol, Dict, Union, Sequence
from langwatch.domain import (
    Conversation,
    Evaluation,
    EvaluationResult,
    EvaluationTimestamps,
    Money,
    MoneyDict,
    SpanMetrics,
    RAGChunk,
    SpanTypes,
    TypedValueEvaluationResult,
    TypedValueGuardrailResult,
    TypedValueJson,
    ChatMessage,
    TypedValueChatMessages,
    TypedValueText,
    TypedValueList,
    ChatRole,
    BaseSpan,
    BaseModel,
    CollectorRESTParams,
    SpanParams,
    SpanInputOutput,
    SpanTimestamps,
    TraceMetadata,
)

# Type aliases for common types
AttributeValue = Union[str, int, float, bool, Sequence[str]]
BaseAttributes = Dict[str, AttributeValue]


class LangWatchClientProtocol(Protocol):
    """Protocol defining the required interface for LangWatch client instances."""
    @property
    def endpoint_url(self) -> str:
        """Get the endpoint URL for the client."""
        ... 

    @property
    def api_key(self) -> str:
        """Get the API key for the client."""
        ...


__all__ = [
    "Conversation",
    "Evaluation",
    "EvaluationResult",
    "EvaluationTimestamps",
    "Money",
    "MoneyDict",
    "SpanMetrics",
    "RAGChunk",
    "SpanTypes",
    "TypedValueEvaluationResult",
    "TypedValueGuardrailResult",
    "TypedValueJson",
    "ChatMessage",
    "TypedValueChatMessages",
    "TypedValueText",
    "TraceMetadata",
    "TypedValueList",
    "ChatRole",
    "BaseSpan",
    "BaseModel",
    "CollectorRESTParams",
    "SpanParams",
    "SpanInputOutput",
    "SpanTimestamps",
]
