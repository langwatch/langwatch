from typing import Literal, Optional
from typing_extensions import NotRequired, TypedDict


class Trace(TypedDict):
    trace_id: str
    input: str
    topic_id: Optional[str]
    subtopic_id: Optional[str]


class TraceWithEmbeddings(Trace):
    embeddings: list[float]


class Topic(TypedDict):
    id: str
    name: str
    centroid: list[float]
    p95_distance: float


class Subtopic(Topic):
    parent_id: str


class TraceTopicMap(TypedDict):
    trace_id: str
    topic_id: Optional[str]
    subtopic_id: Optional[str]


class Money(TypedDict):
    amount: float
    currency: Literal["USD"]


class TraceEmbedding(TypedDict):
    trace_id: str
    # Base64 of int8, scaled so the largest component is 127: 2 KiB for 1536 dimensions.
    embedding: str


class TopicClusteringResponse(TypedDict):
    topics: list[Topic]
    subtopics: list[Subtopic]
    traces: list[TraceTopicMap]
    cost: Money
    # Only when the request sets return_trace_embeddings, so an older caller never sees them.
    trace_embeddings: NotRequired[list[TraceEmbedding]]
    # Embedded traces left out to keep the response under max_response_bytes.
    trace_embeddings_omitted: NotRequired[int]
