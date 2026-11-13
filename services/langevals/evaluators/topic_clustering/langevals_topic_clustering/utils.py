from typing import Optional
import contextvars
import litellm
import numpy as np
from scipy.spatial.distance import cdist
import concurrent.futures
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from langevals_topic_clustering.types import Trace, TraceWithEmbeddings
from langevals_topic_clustering._logger import get_logger

logger = get_logger("topic_clustering.utils")


def calculate_centroid_and_distance(samples) -> tuple[np.ndarray, float]:
    centroid = np.mean([np.array(item["embeddings"]) for item in samples], axis=0)
    distances = cdist(
        [np.array(item["embeddings"]) for item in samples],
        np.array([centroid]),
        "cosine",
    ).flatten()
    p95_distance = np.percentile(distances, 95).astype(float)

    return centroid, p95_distance


def normalize_embedding_dimensions(
    embedding: list[float], target_dim: int = 1536
) -> list[float]:
    if len(embedding) == target_dim:
        return embedding

    if len(embedding) < target_dim:
        return embedding + [0.0] * (target_dim - len(embedding))

    return embedding[:target_dim]


def _generate_single_embedding(
    text: str,
    embeddings_litellm_params: dict[str, str],
    dimensions: int
) -> Optional[list[float]]:
    """Generate embedding for a single text item with proper error handling."""
    try:
        text_to_embed = text if text else "<empty>"
        response = litellm.embedding(
            **embeddings_litellm_params,  # type: ignore
            input=text_to_embed,
        )
        return normalize_embedding_dimensions(
            response.data[0]["embedding"],
            target_dim=dimensions,
        )
    except Exception as e:
        logger.warning("Error generating single embedding", error=str(e), text_preview=text[:100])
        raise e  # Re-raise the exception to be handled by the caller


def generate_embeddings_threaded(
    texts: list[str],
    embeddings_litellm_params: dict[str, str],
    max_workers: int = 8
) -> list[Optional[list[float]]]:
    """Generate embeddings in parallel using ThreadPoolExecutor."""
    dimensions = int(embeddings_litellm_params.get("dimensions", 1536))
    params_copy = embeddings_litellm_params.copy()
    if "dimensions" in params_copy:
        del params_copy["dimensions"]

    embeddings: list[Optional[list[float]]] = []
    errors = 0
    last_error: Optional[Exception] = None

    # Process in smaller chunks to handle errors properly
    chunk_size = 20
    total_chunks = (len(texts) + chunk_size - 1) // chunk_size
    logger.info("Generating embeddings (threaded)", text_count=len(texts), chunk_count=total_chunks)

    for chunk_idx, i in enumerate(range(0, len(texts), chunk_size)):
        chunk = texts[i:i + chunk_size]
        futures = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks, propagating log context to threads
            for text in chunk:
                ctx = contextvars.copy_context()
                futures.append(executor.submit(ctx.run, _generate_single_embedding, text, params_copy, dimensions))

            # Process results as they complete
            for future in futures:
                try:
                    result = future.result()
                    embeddings.append(result)
                except Exception as e:
                    embeddings.append(None)
                    errors += 1
                    last_error = e
                    logger.warning("Error generating embedding", error=str(e))
                    if errors >= 3:
                        logger.error("Too many errors generating embeddings, reraising", error_count=errors)
                        raise e

        if (chunk_idx + 1) % 5 == 0 or chunk_idx == total_chunks - 1:
            logger.info("Embeddings progress (threaded)", chunks_processed=chunk_idx + 1, total_chunks=total_chunks)

    if last_error and errors == len(texts):
        logger.error("All embeddings failed to generate, reraising last error", error_count=errors, error=str(last_error))
        raise last_error

    return embeddings


# The batches of one call are requested this many at a time.
EMBEDDING_BATCH_CONCURRENCY = 8


# Concurrent batches meet a provider's rate limit sooner, and one failed batch
# sends the whole page to the per-text fallback, so a 429 is retried in place.
@retry(
    retry=retry_if_exception_type(litellm.exceptions.RateLimitError),
    wait=wait_exponential(min=2, max=20),
    stop=stop_after_attempt(4),
    reraise=True,
)
def _embed_batch(
    batch: list[str], params: dict[str, str], dimensions: int, single: bool
) -> list[list[float]]:
    response = litellm.embedding(
        **params,  # type: ignore
        input=batch[0] if single else batch,
    )
    return [
        normalize_embedding_dimensions(item["embedding"], target_dim=dimensions)
        for item in response.data
    ]


def generate_embeddings(
    texts: list[str],
    embeddings_litellm_params: dict[str, str],
    batch_size: int = 20,
    max_workers: int = EMBEDDING_BATCH_CONCURRENCY,
) -> list[Optional[list[float]]]:
    """Embeds `texts` in batches of `batch_size`, `max_workers` batches at a time, in order."""
    embeddings: list[Optional[list[float]]] = []
    errors = 0
    last_error: Optional[Exception] = None
    batches = [
        [t if t else "<empty>" for t in texts[i : i + batch_size]]
        for i in range(0, len(texts), batch_size)
    ]
    total_batches = len(batches)

    dimensions = int(embeddings_litellm_params.get("dimensions", 1536))
    params_copy = embeddings_litellm_params.copy()
    if "dimensions" in params_copy:
        # TODO: target_dim is throwing errors for text-embedding-3-small because litellm drop_params is also not working for some reason
        del params_copy["dimensions"]

    logger.info("Generating embeddings", text_count=len(texts), batch_count=total_batches)

    fall_back_to_threaded = False
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, max_workers))
    try:
        # Each batch runs in its own copy of the context, so the request's log
        # context and usage ledger follow it onto the worker thread.
        futures = [
            executor.submit(
                contextvars.copy_context().run,
                _embed_batch,
                batch,
                params_copy,
                dimensions,
                batch_size == 1,
            )
            for batch in batches
        ]
        for batch_idx, (batch, future) in enumerate(zip(batches, futures)):
            try:
                embeddings += future.result()
            except Exception as e:
                if batch_size > 1:
                    # Don't fallback for auth errors — same key will fail for every individual request
                    if isinstance(e, litellm.exceptions.AuthenticationError):
                        logger.warning("Embedding authentication failed, not retrying", error=str(e))
                        raise
                    logger.info("Batch embedding failed, falling back to threaded implementation")
                    fall_back_to_threaded = True
                    break

                embeddings += [None] * len(batch)

                errors += 1
                last_error = e
                logger.warning("Error generating embeddings", error=str(e), batch_preview=batch[:3])
                if errors >= 3:
                    logger.error("Too many errors generating embeddings, reraising", error_count=errors)
                    raise e

            # Log progress every 5 batches or at the end
            if (batch_idx + 1) % 5 == 0 or batch_idx == total_batches - 1:
                logger.info("Embeddings progress", batches_processed=batch_idx + 1, total_batches=total_batches, embeddings_generated=len(embeddings), total_texts=len(texts))
    finally:
        # Batches not yet started are dropped, and the ones in flight finish
        # before any fallback adds its own calls on top of them.
        executor.shutdown(wait=True, cancel_futures=True)

    if fall_back_to_threaded:
        return generate_embeddings_threaded(texts, embeddings_litellm_params)

    if last_error and errors == len(batches):
        logger.error("All embeddings failed to generate, reraising last error", error_count=errors, error=str(last_error))
        raise last_error

    return embeddings


def fill_embeddings(
    traces: list[Trace], embeddings_litellm_params: dict[str, str]
) -> list[TraceWithEmbeddings]:
    traces_ = [t for t in traces if t["input"] and len(t["input"].strip()) > 0]
    embeddings = generate_embeddings(
        [t["input"] for t in traces_], embeddings_litellm_params
    )
    return [
        TraceWithEmbeddings(
            trace_id=trace["trace_id"],
            input=trace["input"],
            embeddings=embedding,
            topic_id=trace["topic_id"],
            subtopic_id=trace["subtopic_id"],
        )
        for trace, embedding in zip(traces_, embeddings)
        if embedding is not None
    ]
