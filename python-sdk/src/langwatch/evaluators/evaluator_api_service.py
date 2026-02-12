"""
API service layer for retrieving LangWatch evaluators via REST API.

Provides read-only access to project evaluators with computed fields.
Uses the generated OpenAPI client for type-safe API communication.
"""
from typing import Dict, List, Any

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.generated.langwatch_rest_api_client.api.default import (
    get_api_evaluators,
    get_api_evaluators_by_id_or_slug,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_evaluators_response_200_item import (
    GetApiEvaluatorsResponse200Item,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_evaluators_by_id_or_slug_response_200 import (
    GetApiEvaluatorsByIdOrSlugResponse200,
)

from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from langwatch.prompts.errors import unwrap_response


def _response_to_dict(item: Any) -> Dict[str, Any]:
    """Convert a generated API response item to a plain dictionary."""
    return item.to_dict()


class EvaluatorApiService:
    """
    API service for retrieving LangWatch evaluators via REST API.

    Provides read-only operations with proper error handling and response unwrapping.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient):
        """Initialize the evaluator API service with a REST API client."""
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "EvaluatorApiService":
        """Create an EvaluatorApiService instance using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def get_all(self) -> List[Dict[str, Any]]:
        """Retrieve all evaluators for the project."""
        resp = get_api_evaluators.sync_detailed(client=self._client)
        items = unwrap_response(
            resp,
            ok_type=list,
            subject="evaluators",
            op="fetch all",
        )
        if items is None:
            raise RuntimeError("Failed to fetch evaluators")
        return [_response_to_dict(item) for item in items]

    def get(self, id_or_slug: str) -> Dict[str, Any]:
        """Retrieve a single evaluator by ID or slug."""
        resp = get_api_evaluators_by_id_or_slug.sync_detailed(
            id_or_slug=id_or_slug,
            client=self._client,
        )
        ok = unwrap_response(
            resp,
            ok_type=GetApiEvaluatorsByIdOrSlugResponse200,
            subject=f'id_or_slug="{id_or_slug}"',
            op="fetch",
        )
        if ok is None:
            raise RuntimeError(
                f"Failed to fetch evaluator with id_or_slug={id_or_slug}"
            )
        return _response_to_dict(ok)

