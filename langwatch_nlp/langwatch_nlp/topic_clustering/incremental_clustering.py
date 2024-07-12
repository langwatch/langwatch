from typing import Optional, TypeVar
from fastapi import FastAPI

import numpy as np
from pydantic import BaseModel
from langwatch_nlp.topic_clustering.constants import (
    COPHENETIC_DISTANCES_FOR_SUBTOPICS,
    COPHENETIC_DISTANCES_FOR_TOPICS,
    MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_SUBTOPIC,
    MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_TOPIC,
)
from langwatch_nlp.topic_clustering.build_response import build_response
from langwatch_nlp.topic_clustering.topic_naming import (
    generate_topic_and_subtopic_names,
)
from langwatch_nlp.topic_clustering.batch_clustering import build_hierarchy
from langwatch_nlp.topic_clustering.types import (
    Money,
    Subtopic,
    Topic,
    TopicClusteringResponse,
    Trace,
    TraceTopicMap,
)
from scipy.spatial.distance import cdist
import numpy as np


U = TypeVar("U", Topic, Subtopic)


def get_matching_topic(trace: Trace, topics: list[U]) -> Optional[U]:
    trace_embeddings = np.array(trace["embeddings"])
    centroid_distances = cdist(
        [trace_embeddings],
        np.array([t["centroid"] for t in topics]),
        "cosine",
    ).flatten()

    # Find the closest topic to assign the trace
    sorted_topics = sorted(zip(topics, centroid_distances), key=lambda x: x[1])

    if sorted_topics[0][1] <= sorted_topics[0][0]["p95_distance"] * 1.1:
        return sorted_topics[0][0]
    else:
        return None


def assign_trace_to_topic(
    trace: Trace, topics: list[Topic], subtopics: list[Subtopic]
) -> TraceTopicMap:
    topic_id = trace["topic_id"]
    subtopic_id = trace["subtopic_id"]

    if not topic_id:
        matching_topic = get_matching_topic(trace, topics)
        if matching_topic:
            topic_id = matching_topic["id"]

    if topic_id and not subtopic_id:
        subtopics_ = [s for s in subtopics if s["parent_id"] == topic_id]

        matching_subtopic = (
            get_matching_topic(trace, subtopics_) if len(subtopics_) > 0 else None
        )

        if matching_subtopic:
            subtopic_id = matching_subtopic["id"]

    return TraceTopicMap(
        trace_id=trace["trace_id"],
        topic_id=topic_id,
        subtopic_id=subtopic_id,
    )


def maybe_create_new_topics(
    model: str,
    litellm_params: dict[str, str],
    traces: list[Trace],
    topics: list[U],
    cophenetic_distances: int,
    with_subtopics=True,
) -> tuple[list[Topic], list[Subtopic], list[TraceTopicMap], Money]:
    average_p95_distance = np.mean([t["p95_distance"] for t in topics]).astype(float)

    new_hierarchy = build_hierarchy(
        traces,
        cophenetic_distances,
        True,
        maximum_p95_distance=average_p95_distance,
        with_subtopics=with_subtopics,
    )

    if len(new_hierarchy.keys()) == 0:
        return [], [], [], Money(amount=0, currency="USD")

    existing = [t["name"] for t in topics]
    if with_subtopics:
        topic_names, subtopic_names, cost = generate_topic_and_subtopic_names(
            model,
            litellm_params,
            new_hierarchy,
            existing=existing,
        )
    else:
        new_hierarchy: dict[str, dict[str, list[Trace]]] = {"New Sub Topics": new_hierarchy}  # type: ignore
        topic_names, subtopic_names, cost = generate_topic_and_subtopic_names(
            model,
            litellm_params,
            new_hierarchy,
            existing=existing,
            skip_topic_names=True,
        )

    new_topics, new_subtopics, new_traces_to_assign = build_response(
        new_hierarchy, topic_names, subtopic_names
    )

    return new_topics, new_subtopics, new_traces_to_assign, cost


def maybe_create_new_topics_and_subtopics_from_unassigned_traces(
    model: str,
    litellm_params: dict[str, str],
    traces: list[Trace],
    topics: list[Topic],
    subtopics: list[Subtopic],
) -> tuple[list[Topic], list[Subtopic], list[TraceTopicMap], Money]:
    cost = Money(amount=0, currency="USD")

    new_traces_to_assign = [
        trace
        for trace in traces
        if not assign_trace_to_topic(trace, topics, subtopics)["topic_id"]
    ]

    new_topics, new_subtopics, new_traces_to_assign = ([], [], [])
    if len(new_traces_to_assign) > MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_TOPIC:
        new_topics, new_subtopics, new_traces_to_assign, cost_ = (
            maybe_create_new_topics(
                model,
                litellm_params,
                new_traces_to_assign,
                topics,
                COPHENETIC_DISTANCES_FOR_TOPICS,
            )
        )
        cost["amount"] += cost_["amount"]

    new_traces_to_assign_to_subtopics_map: dict[str, list[Trace]] = {}
    for trace in traces:
        trace_topic_map = assign_trace_to_topic(trace, topics, subtopics)
        topic_id = trace_topic_map["topic_id"]
        if topic_id and not trace_topic_map["subtopic_id"]:
            if topic_id not in new_traces_to_assign_to_subtopics_map:
                new_traces_to_assign_to_subtopics_map[topic_id] = []
            new_traces_to_assign_to_subtopics_map[topic_id].append(trace)

    for topic_id, traces_ in new_traces_to_assign_to_subtopics_map.items():
        if len(traces_) < MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_SUBTOPIC:
            continue

        subtopics_ = [t for t in subtopics if t["parent_id"] == topic_id]
        _, new_subtopics_, new_traces_to_assign_, cost_ = maybe_create_new_topics(
            model,
            litellm_params,
            traces_,
            subtopics_,
            COPHENETIC_DISTANCES_FOR_SUBTOPICS,
            with_subtopics=False,
        )
        cost["amount"] += cost_["amount"]
        new_subtopics__ = [
            Subtopic(
                id=s["id"],
                name=s["name"],
                centroid=s["centroid"],
                p95_distance=s["p95_distance"],
                parent_id=topic_id,
            )
            for s in new_subtopics_
        ]

        new_subtopics += new_subtopics__
        new_traces_to_assign += new_traces_to_assign_

    return new_topics, new_subtopics, new_traces_to_assign, cost


class IncrementalClusteringParams(BaseModel):
    topics: list[Topic]
    subtopics: list[Subtopic]
    traces: list[Trace]
    model: str
    deployment_name: Optional[str]
    litellm_params: dict[str, str]


def setup_endpoints(app: FastAPI):
    @app.post("/topics/incremental_clustering")
    def topics_incremental_clustering(
        params: IncrementalClusteringParams,
    ) -> TopicClusteringResponse:
        model = params.model
        if model.startswith("azure/") and params.deployment_name:
            model = f"azure/{params.deployment_name}"

        traces_to_assign = []
        for trace in params.traces:
            trace_topic_map = assign_trace_to_topic(
                trace, params.topics, params.subtopics
            )
            if trace_topic_map["topic_id"]:
                traces_to_assign.append(trace_topic_map)

        new_topics, new_subtopics, traces_from_new_topics_to_assign, cost = (
            maybe_create_new_topics_and_subtopics_from_unassigned_traces(
                model=params.model,
                litellm_params=params.litellm_params,
                traces=params.traces,
                topics=params.topics,
                subtopics=params.subtopics,
            )
        )

        return {
            "topics": new_topics,
            "subtopics": new_subtopics,
            "traces": traces_to_assign + traces_from_new_topics_to_assign,
            "cost": cost,
        }
