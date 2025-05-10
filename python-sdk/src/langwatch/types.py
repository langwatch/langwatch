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

    @api_key.setter
    def api_key(self, value: str) -> None:
        """
        Set a new API key for the client. This will:
        - override the current API key
        - flush any existing spans
        - create a new span processor
        - potentially create a new tracer provider
        """
        ...

    @property
    def debug(self) -> bool:
        """Get the debug flag for the client."""
        ...

    @debug.setter
    def debug(self, value: bool) -> None:
        """Set the debug flag for the client."""
        ...

    @property
    def disable_sending(self) -> bool:
        """Get the disable_sending flag for the client."""
        ...

    @disable_sending.setter
    def disable_sending(self, value: bool) -> None:
        """Set the disable_sending flag for the client."""
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
