"""Collects a clustering request's provider usage onto its response (ADR-193)."""

import functools
from typing import Any, Callable

from langevals_core.usage_ledger import collect_usage


def with_usage(endpoint: Callable[..., dict[str, Any]]) -> Callable[..., dict[str, Any]]:
    """Runs the endpoint inside a usage collection and returns what the
    embedding and naming calls consumed on its response."""

    @functools.wraps(endpoint)
    def wrapped(*args: Any, **kwargs: Any) -> dict[str, Any]:
        with collect_usage() as usage:
            response = endpoint(*args, **kwargs)
        return {**response, "usage": [model.model_dump() for model in usage.models()]}

    return wrapped
