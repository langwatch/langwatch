from typing import Any, Optional, TypeVar
from fastapi import FastAPI, HTTPException

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
    TraceWithEmbeddings,
)
from scipy.spatial.distance import cdist
import numpy as np

from langwatch_nlp.topic_clustering.utils import fill_embeddings
from langwatch_nlp.logger import get_logger, set_log_context, clear_log_context

logger = get_logger("topic_clustering.incremental")


U = TypeVar("U", Topic, Subtopic)


def get_matching_topic(trace: TraceWithEmbeddings, topics: list[U]) -> Optional[U]:
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
    trace: TraceWithEmbeddings, topics: list[Topic], subtopics: list[Subtopic]
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
    embeddings_litellm_params: dict[str, str],
    traces: list[TraceWithEmbeddings],
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
            embeddings_litellm_params,
            new_hierarchy,
            existing=existing,
        )
    else:
        new_hierarchy: dict[str, dict[str, list[Trace]]] = {"New Sub Topics": new_hierarchy}  # type: ignore
        topic_names, subtopic_names, cost = generate_topic_and_subtopic_names(
            model,
            litellm_params,
            embeddings_litellm_params,
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
    embeddings_litellm_params: dict[str, str],
    traces: list[TraceWithEmbeddings],
    topics: list[Topic],
    subtopics: list[Subtopic],
) -> tuple[list[Topic], list[Subtopic], list[TraceTopicMap], Money]:
    cost = Money(amount=0, currency="USD")

    logger.info("Checking for unassigned traces that need new topics")
    new_traces_to_assign = [
        trace
        for trace in traces
        if not assign_trace_to_topic(trace, topics, subtopics)["topic_id"]
    ]
    logger.info("Found unassigned traces", unassigned_count=len(new_traces_to_assign))

    new_topics, new_subtopics, new_traces_to_assign = ([], [], [])
    if len(new_traces_to_assign) > MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_TOPIC:
        logger.info(
            "Creating new topics from unassigned traces",
            unassigned_count=len(new_traces_to_assign),
            threshold=MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_TOPIC,
        )
        new_topics, new_subtopics, new_traces_to_assign, cost_ = (
            maybe_create_new_topics(
                model,
                litellm_params,
                embeddings_litellm_params,
                new_traces_to_assign,
                topics,
                COPHENETIC_DISTANCES_FOR_TOPICS,
            )
        )
        cost["amount"] += cost_["amount"]
        logger.info("Created new topics", new_topics=len(new_topics), new_subtopics=len(new_subtopics))

    new_traces_to_assign_to_subtopics_map: dict[str, list[TraceWithEmbeddings]] = {}
    for trace in traces:
        trace_topic_map = assign_trace_to_topic(trace, topics, subtopics)
        topic_id = trace_topic_map["topic_id"]
        if topic_id and not trace_topic_map["subtopic_id"]:
            if topic_id not in new_traces_to_assign_to_subtopics_map:
                new_traces_to_assign_to_subtopics_map[topic_id] = []
            new_traces_to_assign_to_subtopics_map[topic_id].append(trace)

    topics_needing_subtopics = [
        (topic_id, len(traces_))
        for topic_id, traces_ in new_traces_to_assign_to_subtopics_map.items()
        if len(traces_) >= MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_SUBTOPIC
    ]
    if topics_needing_subtopics:
        logger.info("Checking existing topics for new subtopics", topic_count=len(topics_needing_subtopics))

    for idx, (topic_id, traces_) in enumerate(
        new_traces_to_assign_to_subtopics_map.items()
    ):
        if len(traces_) < MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_SUBTOPIC:
            continue

        logger.info(
            "Processing topic for subtopics",
            topic_progress=f"{idx + 1}/{len(topics_needing_subtopics)}",
            trace_count=len(traces_),
        )

        subtopics_ = [t for t in subtopics if t["parent_id"] == topic_id]
        _, new_subtopics_, new_traces_to_assign_, cost_ = maybe_create_new_topics(
            model,
            litellm_params,
            embeddings_litellm_params,
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
        logger.info(
            "Topic subtopics created",
            topic_progress=f"{idx + 1}/{len(topics_needing_subtopics)}",
            new_subtopics=len(new_subtopics__),
        )

    return new_topics, new_subtopics, new_traces_to_assign, cost


class IncrementalClusteringParams(BaseModel):
    project_id: str
    topics: list[Topic]
    subtopics: list[Subtopic]
    traces: list[Trace]
    deployment_name: Optional[str] = None
    litellm_params: dict[str, str]
    embeddings_litellm_params: dict[str, Any]


def setup_endpoints(app: FastAPI):
    @app.post("/topics/incremental_clustering")
    def topics_incremental_clustering(
        params: IncrementalClusteringParams,
    ) -> TopicClusteringResponse:
        try:
            set_log_context(project_id=params.project_id)
            logger.info(
                "Starting incremental clustering",
                trace_count=len(params.traces),
                existing_topics=len(params.topics),
                existing_subtopics=len(params.subtopics),
            )

            # Validate model and API key configuration
            model = params.litellm_params.get("model", "")
            if not model:
                logger.warning("No model configured for topic clustering, skipping")
                return {"topics": [], "subtopics": [], "traces": [], "cost": {"amount": 0, "currency": "USD"}}

            api_key = params.litellm_params.get("api_key", "")
            embeddings_api_key = params.embeddings_litellm_params.get("api_key", "")
            if api_key in ("", "dummy") or embeddings_api_key in ("", "dummy"):
                logger.warning(
                    "Invalid API key for topic clustering, skipping",
                    has_model_key=bool(api_key and api_key != "dummy"),
                    has_embeddings_key=bool(embeddings_api_key and embeddings_api_key != "dummy"),
                )
                return {"topics": [], "subtopics": [], "traces": [], "cost": {"amount": 0, "currency": "USD"}}

            model = params.litellm_params["model"]
            if model.startswith("azure/") and params.deployment_name:
                model = f"azure/{params.deployment_name}"

            logger.info("Generating embeddings for new traces", step="1/3")
            traces_with_embeddings = fill_embeddings(
                params.traces, params.embeddings_litellm_params
            )
            logger.info(
                "Embeddings complete",
                step="1/3",
                traces_with_embeddings=len(traces_with_embeddings),
            )

            logger.info("Assigning traces to existing topics and subtopics", step="2/3")
            traces_to_assign = []
            for trace in traces_with_embeddings:
                trace_topic_map = assign_trace_to_topic(
                    trace, params.topics, params.subtopics
                )
                if trace_topic_map["topic_id"]:
                    traces_to_assign.append(trace_topic_map)
            logger.info(
                "Assigned traces to existing topics",
                step="2/3",
                assigned_count=len(traces_to_assign),
            )

            logger.info("Creating new topics/subtopics from unassigned traces", step="3/3")
            new_topics, new_subtopics, traces_from_new_topics_to_assign, cost = (
                maybe_create_new_topics_and_subtopics_from_unassigned_traces(
                    model=params.litellm_params["model"],
                    litellm_params=params.litellm_params,
                    embeddings_litellm_params=params.embeddings_litellm_params,
                    traces=traces_with_embeddings,
                    topics=params.topics,
                    subtopics=params.subtopics,
                )
            )

            total_traces = len(traces_to_assign) + len(traces_from_new_topics_to_assign)
            logger.info(
                "Incremental clustering complete",
                new_topics=len(new_topics),
                new_subtopics=len(new_subtopics),
                total_trace_assignments=total_traces,
            )

            return {
                "topics": new_topics,
                "subtopics": new_subtopics,
                "traces": traces_to_assign + traces_from_new_topics_to_assign,
                "cost": cost,
            }
        except Exception as e:
            logger.error("Incremental clustering failed", error=str(e), error_type=type(e).__name__)
            raise HTTPException(status_code=500, detail="Incremental clustering failed") from e
        finally:
            clear_log_context()
