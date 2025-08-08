# src/langwatch/prompt/service.py
"""
Service layer for managing LangWatch prompts via REST API.

This module provides a high-level interface for CRUD operations on prompts,
handling API communication, error handling, and response unwrapping.
"""
from typing import Dict, Any, Callable, Awaitable, Union
import asyncio
from functools import wraps
from opentelemetry import trace
from langwatch.attributes import AttributeKey
from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.generated.langwatch_rest_api_client.api.default import (
    get_api_prompts_by_id,
    post_api_prompts,
    put_api_prompts_by_id,
    delete_api_prompts_by_id,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body import (
    PostApiPromptsBody,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body import (
    PutApiPromptsByIdBody,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_response_200 import (
    PutApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.delete_api_prompts_by_id_response_200 import (
    DeleteApiPromptsByIdResponse200,
)
from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from .prompt import Prompt
from .errors import unwrap_response
from .tracing import trace_prompt


class PromptService:
    """
    Service for managing LangWatch prompts via REST API.

    Provides CRUD operations for prompts with proper error handling and response
    unwrapping. Follows single responsibility principle by focusing solely on
    prompt API operations.

    Attributes:
        _client: The REST API client for making HTTP requests
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient):
        """
        Initialize the prompt service with a REST API client.

        Args:
            rest_api_client: Configured LangWatch REST API client
        """
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "PromptService":
        """
        Create a PromptService instance using the global LangWatch configuration.

        Ensures LangWatch is properly initialized and retrieves the global
        REST API client instance.

        Returns:
            PromptService instance configured with global client

        Raises:
            RuntimeError: If LangWatch has not been initialized via setup()
        """
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    @trace_prompt("get", lambda _self, prompt_id, **_: {"inputs.prompt_id": prompt_id})
    def get(self, prompt_id: str) -> Prompt:
        """
        Retrieve a prompt by its ID.

        Args:
            prompt_id: Unique identifier for the prompt

        Returns:
            Prompt object containing the retrieved prompt data

        Raises:
            ValueError: If prompt is not found (404) or request is invalid (400)
            RuntimeError: For authentication (401) or server errors (5xx)
        """
        resp = get_api_prompts_by_id.sync_detailed(id=prompt_id, client=self._client)
        ok = unwrap_response(
            resp,
            ok_type=GetApiPromptsByIdResponse200,
            subject=f'id="{prompt_id}"',
            op="fetch",
        )
        return Prompt(ok)

    @trace_prompt("create", lambda _self, name, **_: {"inputs.name": name})
    def create(self, name: str) -> Prompt:
        """
        Create a new prompt with the specified name.

        Args:
            name: Name for the new prompt

        Returns:
            Prompt object containing the created prompt data

        Raises:
            ValueError: If request is invalid (400)
            RuntimeError: For authentication (401) or server errors (5xx)
        """
        resp = post_api_prompts.sync_detailed(
            client=self._client, body=PostApiPromptsBody(name=name)
        )
        ok = unwrap_response(
            resp,
            ok_type=PostApiPromptsResponse200,
            subject=f'name="{name}"',
            op="create",
        )
        return Prompt(ok)

    @trace_prompt(
        "update",
        lambda _self, prompt_id, name, **_: {
            "inputs.prompt_id": prompt_id,
            "inputs.name": name,
        },
    )
    def update(self, prompt_id: str, name: str) -> Prompt:
        """
        Update an existing prompt's name.

        Note: After updating, fetches the latest prompt data to ensure consistency.
        This approach trades an extra API call for data accuracy.

        Args:
            prompt_id: Unique identifier for the prompt to update
            name: New name for the prompt

        Returns:
            Prompt object containing the updated prompt data

        Raises:
            ValueError: If prompt is not found (404) or request is invalid (400)
            RuntimeError: For authentication (401) or server errors (5xx)
        """
        resp = put_api_prompts_by_id.sync_detailed(
            id=prompt_id, client=self._client, body=PutApiPromptsByIdBody(name=name)
        )
        unwrap_response(
            resp,
            ok_type=PutApiPromptsByIdResponse200,
            subject=f'id="{prompt_id}"',
            op="update",
        )
        return self.get(prompt_id)

    @trace_prompt(
        "delete", lambda _self, prompt_id, **_: {"inputs.prompt_id": prompt_id}
    )
    def delete(self, prompt_id: str) -> Dict[str, bool]:
        """
        Delete a prompt by its ID.

        Args:
            prompt_id: Unique identifier for the prompt to delete

        Returns:
            Dictionary with 'success' key indicating deletion result

        Raises:
            ValueError: If prompt is not found (404) or request is invalid (400)
            RuntimeError: For authentication (401) or server errors (5xx)
        """
        resp = delete_api_prompts_by_id.sync_detailed(id=prompt_id, client=self._client)
        ok = unwrap_response(
            resp,
            ok_type=DeleteApiPromptsByIdResponse200,
            subject=f'id="{prompt_id}"',
            op="delete",
        )
        return {"success": bool(ok.success)}
