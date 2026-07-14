"""Internal type definitions and constants for the OpenTelemetry integration.
This module is for internal use only and may change without notice."""

from typing import List, Optional, Union
from uuid import UUID
from langwatch.domain import ChatMessage, SpanInputOutput, RAGChunk

# Internal type aliases - not exposed to users
SpanInputType = Optional[Union[SpanInputOutput, str, List[ChatMessage]]]
ContextsType = Optional[Union[List[RAGChunk], List[str]]]
TraceIdType = Optional[Union[str, UUID]]
