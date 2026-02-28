from typing import Any, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langwatch_nlp.topic_clustering.build_response import build_response
from langwatch_nlp.topic_clustering.topic_naming import (
    generate_topic_and_subtopic_names,
)
from langwatch_nlp.topic_clustering.utils import (
    calculate_centroid_and_distance,
    fill_embeddings,
)
from langwatch_nlp.topic_clustering.constants import (
    COPHENETIC_DISTANCES_FOR_SUBTOPICS,
    COPHENETIC_DISTANCES_FOR_TOPICS,
    MINIMUM_SUBTOPICS_PER_TOPIC,
    MINIMUM_TRACES_PER_TOPIC,
)
from langwatch_nlp.topic_clustering.types import (
    TopicClusteringResponse,
    Trace,
    TraceWithEmbeddings,
)
from scipy.cluster.hierarchy import linkage, fcluster
from langwatch_nlp.logger import get_logger, set_log_context, clear_log_context

logger = get_logger("topic_clustering.batch")


def build_hierarchy(
    traces: list[TraceWithEmbeddings],
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
    project_id: str
    traces: list[Trace]
    deployment_name: Optional[str] = None
    litellm_params: dict[str, str]
    embeddings_litellm_params: dict[str, Any]


def setup_endpoints(app: FastAPI):
    @app.post("/topics/batch_clustering")
    def topics_batch_clustering(
        params: BatchClusteringParams,
    ) -> TopicClusteringResponse:
        try:
            set_log_context(project_id=params.project_id)
            logger.info("Starting batch clustering", trace_count=len(params.traces))

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

            logger.info("Generating embeddings for traces", step="1/4")
            traces_with_embeddings = fill_embeddings(
                params.traces, params.embeddings_litellm_params
            )
            logger.info(
                "Embeddings complete",
                step="1/4",
                traces_with_embeddings=len(traces_with_embeddings),
            )

            logger.info("Building hierarchy from embeddings", step="2/4")
            hierarchy = build_hierarchy(
                traces_with_embeddings, COPHENETIC_DISTANCES_FOR_TOPICS
            )
            logger.info("Hierarchy built", step="2/4", topics_identified=len(hierarchy))

            logger.info("Generating topic and subtopic names", step="3/4")
            topic_names, subtopic_names, cost = generate_topic_and_subtopic_names(
                model=model,
                litellm_params=params.litellm_params,
                embeddings_litellm_params=params.embeddings_litellm_params,
                hierarchy=hierarchy,
            )
            logger.info("Names generated", step="3/4", topic_count=len(topic_names))

            logger.info("Building final response", step="4/4")
            topics, subtopics, traces_to_assign = build_response(
                hierarchy, topic_names, subtopic_names
            )
            logger.info(
                "Batch clustering complete",
                topic_count=len(topics),
                subtopic_count=len(subtopics),
                trace_assignment_count=len(traces_to_assign),
            )

            return {
                "topics": topics,
                "subtopics": subtopics,
                "traces": traces_to_assign,
                "cost": cost,
            }
        except Exception as e:
            logger.error("Batch clustering failed", error=str(e), error_type=type(e).__name__)
            raise HTTPException(status_code=500, detail="Batch clustering failed") from e
        finally:
            clear_log_context()
