from typing import Optional
from fastapi import FastAPI
from pydantic import BaseModel
from langwatch_nlp.topic_clustering.build_response import build_response
from langwatch_nlp.topic_clustering.topic_naming import (
    generate_topic_and_subtopic_names,
)
from langwatch_nlp.topic_clustering.utils import calculate_centroid_and_distance
from langwatch_nlp.topic_clustering.constants import (
    COPHENETIC_DISTANCES_FOR_SUBTOPICS,
    COPHENETIC_DISTANCES_FOR_TOPICS,
    MINIMUM_SUBTOPICS_PER_TOPIC,
    MINIMUM_TRACES_PER_TOPIC,
)
from langwatch_nlp.topic_clustering.types import TopicClusteringResponse, Trace
from scipy.cluster.hierarchy import linkage, fcluster


def build_hierarchy(
    traces: list[Trace],
    cophenetic_distance: int,
    with_embeddings=True,
    maximum_p95_distance: float = 1,
    with_subtopics=True,
) -> dict[str, dict[str, list[Trace]]]:
    embeddings = [t["embeddings"] for t in traces]
    Z = linkage(embeddings, "ward")
    topic_ids = fcluster(Z, cophenetic_distance, criterion="distance")

    # Dictionary to hold our two-level hierarchy
    hierarchy = {}

    # Iterate over each unique topic to create subtopics
    for topic_id in set(topic_ids):
        # Isolate samples that belong to the current topic
        indices_in_topic = [i for i, t in enumerate(topic_ids) if t == topic_id]

        traces_in_topic = [traces[i] for i in indices_in_topic]

        # If there's less than the minimum number of traces, skip this topic
        unique_inputs = set([t["input"] for t in traces_in_topic])
        if len(unique_inputs) < MINIMUM_TRACES_PER_TOPIC:
            continue

        _, p95_distance = calculate_centroid_and_distance(traces_in_topic)
        # Skip this topic if the p95 distance is too large
        if p95_distance > maximum_p95_distance:
            continue

        if with_subtopics:
            subtopics = build_hierarchy(
                traces_in_topic,
                COPHENETIC_DISTANCES_FOR_SUBTOPICS,
                with_embeddings,
                maximum_p95_distance,
                False,
            )

            if len(subtopics.keys()) < MINIMUM_SUBTOPICS_PER_TOPIC:
                continue

            hierarchy[f"Topic {topic_id}"] = subtopics
        else:
            hierarchy[f"Subtopic {topic_id}"] = [
                Trace(
                    trace_id=traces[i]["trace_id"],
                    input=traces[i]["input"],
                    embeddings=traces[i]["embeddings"] if with_embeddings else "[embeddings]",  # type: ignore
                )
                for i in indices_in_topic
            ]

    return hierarchy


class BatchClusteringParams(BaseModel):
    traces: list[Trace]
    deployment_name: Optional[str] = None
    litellm_params: dict[str, str]
    embeddings_litellm_params: dict[str, str]


def setup_endpoints(app: FastAPI):
    @app.post("/topics/batch_clustering")
    def topics_batch_clustering(
        params: BatchClusteringParams,
    ) -> TopicClusteringResponse:
        model = params.litellm_params["model"]
        if model.startswith("azure/") and params.deployment_name:
            model = f"azure/{params.deployment_name}"

        hierarchy = build_hierarchy(params.traces, COPHENETIC_DISTANCES_FOR_TOPICS)
        topic_names, subtopic_names, cost = generate_topic_and_subtopic_names(
            model=model,
            litellm_params=params.litellm_params,
            embeddings_litellm_params=params.embeddings_litellm_params,
            hierarchy=hierarchy,
        )
        topics, subtopics, traces_to_assign = build_response(
            hierarchy, topic_names, subtopic_names
        )

        return {
            "topics": topics,
            "subtopics": subtopics,
            "traces": traces_to_assign,
            "cost": cost,
        }
