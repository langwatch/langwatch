from typing import Any, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langevals_topic_clustering.build_response import build_response
from langevals_topic_clustering.topic_naming import (
    generate_topic_and_subtopic_names,
)
from langevals_topic_clustering.utils import (
    calculate_centroid_and_distance,
    fill_embeddings,
)
from langevals_topic_clustering.constants import (
    COPHENETIC_DISTANCES_FOR_SUBTOPICS,
    COPHENETIC_DISTANCES_FOR_TOPICS,
    MINIMUM_SUBTOPICS_PER_TOPIC,
    MINIMUM_TRACES_PER_TOPIC,
)
from langevals_topic_clustering.types import (
    TopicClusteringResponse,
    Trace,
    TraceWithEmbeddings,
)
from scipy.cluster.hierarchy import linkage, fcluster
import litellm
from langevals_topic_clustering._logger import get_logger, set_log_context, clear_log_context

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


def customer_failure(error: Exception) -> Optional[HTTPException]:
    """The 4xx a failure the customer fixes answers with, or None when it is ours.

    The detail carries a stable code and fixed copy, never the provider's own
    words: those can quote part of the key that was refused.
    """
    if isinstance(error, litellm.exceptions.AuthenticationError):
        return HTTPException(
            status_code=422,
            detail={
                "code": "model_provider_auth_failed",
                "message": "The model provider refused the configured API key.",
            },
        )
    if isinstance(error, litellm.exceptions.RateLimitError):
        return HTTPException(
            status_code=429,
            detail={
                "code": "model_provider_rate_limited",
                "message": "The model provider is rate limiting or out of quota for the configured key.",
            },
        )
    if isinstance(error, litellm.exceptions.BadRequestError):
        return HTTPException(
            status_code=422,
            detail={
                "code": "model_provider_bad_request",
                "message": "The model provider rejected the request for the configured model.",
            },
        )
    return None


def setup_endpoints(app: FastAPI):
    @app.post("/topics/batch_clustering")
    def topics_batch_clustering(
        params: BatchClusteringParams,
    ) -> TopicClusteringResponse:
        try:
            set_log_context(project_id=params.project_id)
            logger.info("Starting batch clustering", trace_count=len(params.traces))

            model = params.litellm_params.get("model")
            if not model:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "model_not_configured",
                        "message": "No model is configured for topic clustering.",
                    },
                )
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
        except HTTPException as e:
            logger.warning("Batch clustering refused", status_code=e.status_code, detail=e.detail)
            raise
        except Exception as e:
            refusal = customer_failure(e)
            if refusal is not None:
                logger.warning(
                    "Batch clustering refused by the model provider",
                    status_code=refusal.status_code,
                    error_type=type(e).__name__,
                )
                raise refusal from e
            logger.error("Batch clustering failed", error=str(e), error_type=type(e).__name__)
            raise HTTPException(status_code=500, detail="Batch clustering failed") from e
        finally:
            clear_log_context()
