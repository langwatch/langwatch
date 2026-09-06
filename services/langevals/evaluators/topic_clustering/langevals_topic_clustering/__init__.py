"""LangEvals Topic Clustering — Special evaluator package.

Topic clustering doesn't fit the per-trace evaluator interface (it's a batch
operation that takes many traces and returns topics+subtopics+assignments).
This module exposes a `register_routes(app)` hook that mounts two custom
endpoints on the langevals FastAPI app:

  - POST /topics/batch_clustering
  - POST /topics/incremental_clustering

The langevals server.py imports this module conditionally and calls
register_routes() so the package is opt-in (won't break per-evaluator
deployments that don't include topic_clustering).

Source: migrated from langwatch_nlp/topic_clustering/* in 2026-04 as part of
the langwatch_nlp → Go migration. Topic clustering itself stays Python
(sklearn + scipy + numpy + LiteLLM); only the hosting service changes from
langwatch_nlp to langevals so all Python long-term lives in one place.
"""

from fastapi import FastAPI

from langevals_topic_clustering import batch_clustering, incremental_clustering


def register_routes(app: FastAPI) -> None:
    """Mount topic-clustering routes on the given FastAPI app.

    Idempotent only insofar as FastAPI accepts duplicate route registration:
    do not call twice on the same app instance.
    """
    batch_clustering.setup_endpoints(app)
    incremental_clustering.setup_endpoints(app)


__all__ = ["register_routes"]
