from typing import Literal, Optional
from typing_extensions import TypedDict


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


class ModelUsageEntry(TypedDict):
    model: str
    calls: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    reasoning_tokens: int


class TopicClusteringResponse(TypedDict):
    topics: list[Topic]
    subtopics: list[Subtopic]
    traces: list[TraceTopicMap]
    cost: Money
    # The embedding and naming calls' provider usage, summed per model, for
    # the spend ledger (ADR-193).
    usage: list[ModelUsageEntry]
