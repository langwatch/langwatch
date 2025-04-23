"""Internal type definitions and constants for the OpenTelemetry integration.
This module is for internal use only and may change without notice."""

from typing_extensions import Literal
from typing import List, Optional, Union
from uuid import UUID
from langwatch.domain import ChatMessage, SpanInputOutput, RAGChunk

# Internal type aliases - not exposed to users
SpanInputType = Optional[Union[SpanInputOutput, str, List[ChatMessage]]]
ContextsType = Optional[Union[List[RAGChunk], List[str]]]
TraceIdType = Optional[Union[str, UUID]]

# Keep the original SpanType definition for compatibility
SpanType = Literal[
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
    "module",
    "task",
    "unknown",
] 
