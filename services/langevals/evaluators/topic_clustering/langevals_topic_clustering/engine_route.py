"""A clustering request's model calls the app sent through its engine proxy (ADR-203)."""

from typing import TypeVar

from pydantic import BaseModel
from starlette.requests import Request

from langevals_core.engine_proxy import engine_route, with_engine_credential

Params = TypeVar("Params", bound=BaseModel)


def with_engine_route(params: Params, http_request: Request) -> Params:
    """The params with the engine's credential on each call that goes to the engine proxy."""
    route = engine_route(http_request.headers)
    if route is None:
        return params
    return params.model_copy(
        update={
            "litellm_params": with_engine_credential(
                getattr(params, "litellm_params"), route
            ),
            "embeddings_litellm_params": with_engine_credential(
                getattr(params, "embeddings_litellm_params"), route
            ),
        }
    )
