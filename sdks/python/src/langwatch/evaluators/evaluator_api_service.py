"""
API service layer for managing LangWatch evaluators via REST API.

Provides access to project evaluators with computed fields.
Uses the generated OpenAPI client for type-safe API communication.
"""
import urllib.parse
from typing import Any, Dict, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.generated.langwatch_rest_api_client.api.default import (
    get_api_evaluators,
    get_api_evaluators_by_id_or_slug,
    post_api_evaluators,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_evaluators_response_200_item import (
    GetApiEvaluatorsResponse200Item,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_evaluators_by_id_or_slug_response_200 import (
    GetApiEvaluatorsByIdOrSlugResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_evaluators_body import (
    PostApiEvaluatorsBody,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_evaluators_body_config import (
    PostApiEvaluatorsBodyConfig,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_evaluators_response_200 import (
    PostApiEvaluatorsResponse200,
)

from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from langwatch.prompts.errors import unwrap_response
from langwatch.utils.exceptions import extract_api_error_detail


def _raise_for_status(response: httpx.Response, *, subject: str, op: str) -> None:
    """Raise with the platform's error detail when the call failed."""
    if response.is_success:
        return
    try:
        detail = extract_api_error_detail(response.json())
    except ValueError:
        detail = response.text or ""
    if response.status_code == 404:
        raise ValueError(f"Evaluator not found ({subject}): {detail}")
    raise RuntimeError(
        f"Failed to {op} evaluator ({subject}), status {response.status_code}: {detail}"
    )


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _response_to_dict(item: Any) -> Dict[str, Any]:
    """Convert a generated API response item to a plain dictionary."""
    return item.to_dict()


class EvaluatorApiService:
    """
    API service for managing LangWatch evaluators via REST API.

    Provides CRUD operations with proper error handling and response unwrapping.
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

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

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

    def get(
        self,
        id_or_slug: str,
        *,
        label: Optional[str] = None,
        version: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Retrieve a single evaluator by ID or slug, at the latest version unless a label or a
        version is given. The slug also takes a suffix: "toxicity:production" or "toxicity:2".
        """
        if label is not None or version is not None:
            params: Dict[str, Any] = {}
            if label is not None:
                params["label"] = label
            if version is not None:
                params["version"] = version
            response = self._http().get(
                f"/api/v1/evaluators/{_quote(id_or_slug)}", params=params
            )
            _raise_for_status(response, subject=f'id_or_slug="{id_or_slug}"', op="fetch")
            return response.json()
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

    def create(self, name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new evaluator.

        Args:
            name: Name for the evaluator (1-255 chars).
            config: Configuration dict, e.g. {"evaluatorType": "langevals/exact_match", "settings": {}}.

        Returns:
            Dictionary containing the created evaluator data.
        """
        resp = post_api_evaluators.sync_detailed(
            client=self._client,
            body=PostApiEvaluatorsBody(
                name=name,
                config=PostApiEvaluatorsBodyConfig.from_dict(config),
            ),
        )
        ok = unwrap_response(
            resp,
            ok_type=PostApiEvaluatorsResponse200,
            subject=f'name="{name}"',
            op="create",
        )
        if ok is None:
            raise RuntimeError(f"Failed to create evaluator with name={name}")
        return _response_to_dict(ok)

    def list_versions(self, evaluator_id: str) -> Dict[str, Any]:
        """
        List an evaluator's versions, newest first, with the deploy labels on each.

        Returns:
            Dictionary with a 'data' list of versions and the 'labels' with their versions.
        """
        response = self._http().get(
            f"/api/v1/evaluators/{_quote(evaluator_id)}/versions"
        )
        _raise_for_status(response, subject=f'id="{evaluator_id}"', op="list versions of")
        return response.json()

    def assign_label(self, evaluator_id: str, label: str, version: int) -> Dict[str, Any]:
        """Point a deploy label, such as "production", at one of the evaluator's versions."""
        response = self._http().put(
            f"/api/v1/evaluators/{_quote(evaluator_id)}/labels/{_quote(label)}",
            json={"version": version},
        )
        _raise_for_status(response, subject=f'id="{evaluator_id}"', op="deploy a label of")
        return response.json()

    def remove_label(self, evaluator_id: str, label: str) -> Dict[str, Any]:
        """Remove a deploy label from the evaluator."""
        response = self._http().delete(
            f"/api/v1/evaluators/{_quote(evaluator_id)}/labels/{_quote(label)}"
        )
        _raise_for_status(response, subject=f'id="{evaluator_id}"', op="remove a label of")
        return response.json()
