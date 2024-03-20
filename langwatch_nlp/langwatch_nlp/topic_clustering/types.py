from typing import Literal, Optional
from typing_extensions import TypedDict


class Trace(TypedDict):
    trace_id: str
    input: str
    embeddings: list[float]
    topic_id: Optional[str]
    subtopic_id: Optional[str]


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


class TopicClusteringResponse(TypedDict):
    topics: list[Topic]
    subtopics: list[Subtopic]
    traces: list[TraceTopicMap]
    cost: Money
