# src/langwatch/prompt/service.py
"""
Service layer for managing LangWatch prompts via REST API.

This module provides a high-level interface for CRUD operations on prompts,
handling API communication, error handling, and response unwrapping.
Uses TypedDict for clean interfaces and from_dict methods for type safety.
"""
from typing import Dict, List, Literal, Optional, Any, TypedDict
from langwatch.generated.langwatch_rest_api_client.types import UNSET
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
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_messages_item import (
    PostApiPromptsBodyMessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_inputs_item import (
    PostApiPromptsBodyInputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_outputs_item import (
    PostApiPromptsBodyOutputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_body_scope import (
    PostApiPromptsBodyScope,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body import (
    PutApiPromptsByIdBody,
    PutApiPromptsByIdBodyScope,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body_messages_item import (
    PutApiPromptsByIdBodyMessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body_inputs_item import (
    PutApiPromptsByIdBodyInputsItem,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_body_outputs_item import (
    PutApiPromptsByIdBodyOutputsItem,
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
from .decorators.prompt_service_tracing import prompt_service_tracing
from .types import MessageDict, InputDict, OutputDict


def _convert_api_response_to_get_format(response: Any) -> GetApiPromptsByIdResponse200:
    """Convert any API response to GetApiPromptsByIdResponse200 format using from_dict."""
    if isinstance(response, GetApiPromptsByIdResponse200):
        return response

    # All response types have the same structure, so we can convert via dict
    return GetApiPromptsByIdResponse200.from_dict(response.to_dict())


class PromptService:
    """
    Service for managing LangWatch prompts via REST API.

    Provides CRUD operations for prompts with proper error handling and response
    unwrapping. Uses TypedDict interfaces for clean, type-safe API.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient):
        """Initialize the prompt service with a REST API client."""
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "PromptService":
        """Create a PromptService instance using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    @prompt_service_tracing.get
    def get(self, prompt_id: str, version_number: Optional[int] = None) -> Prompt:
        """Retrieve a prompt by its ID. You can optionally specify a version number to get a specific version of the prompt."""
        resp = get_api_prompts_by_id.sync_detailed(
            id=prompt_id,
            client=self._client,
            version=version_number if version_number is not None else UNSET,
        )
        ok = unwrap_response(
            resp,
            ok_type=GetApiPromptsByIdResponse200,
            subject=f'handle_or_id="{prompt_id}"',
            op="fetch",
        )
        if ok is None:
            raise RuntimeError(
                f"Failed to fetch prompt with handle_or_id={prompt_id} version={version_number if version_number is not None else 'latest'}"
            )
        return Prompt(ok)

    def create(
        self,
        handle: str,
        author_id: Optional[str] = None,
        scope: Literal["PROJECT", "ORGANIZATION"] = "PROJECT",
        prompt: Optional[str] = None,
        messages: Optional[List[MessageDict]] = None,
        inputs: Optional[List[InputDict]] = None,
        outputs: Optional[List[OutputDict]] = None,
    ) -> Prompt:
        """
        Create a new prompt with clean dictionary interfaces.

        Args:
            handle: Unique identifier for the prompt
            author_id: ID of the author
            scope: Scope of the prompt ('PROJECT' or 'ORGANIZATION')
            prompt: The prompt text content
            messages: List of message dicts with 'role' and 'content' keys
            inputs: List of input dicts with 'identifier' and 'type' keys
            outputs: List of output dicts with 'identifier', 'type', and optional 'json_schema' keys

        Returns:
            Prompt object containing the created prompt data
        """
        # Convert dicts to API models using from_dict
        api_messages = UNSET
        if messages:
            api_messages = [
                PostApiPromptsBodyMessagesItem.from_dict(msg) for msg in messages
            ]

        api_inputs = UNSET
        if inputs:
            api_inputs = [PostApiPromptsBodyInputsItem.from_dict(inp) for inp in inputs]

        api_outputs = UNSET
        if outputs:
            api_outputs = [
                PostApiPromptsBodyOutputsItem.from_dict(out) for out in outputs
            ]

        resp = post_api_prompts.sync_detailed(
            client=self._client,
            body=PostApiPromptsBody(
                handle=handle,
                scope=PostApiPromptsBodyScope(scope),
                author_id=author_id or UNSET,
                prompt=prompt or UNSET,
                messages=api_messages,
                inputs=api_inputs,
                outputs=api_outputs,
            ),
        )
        ok = unwrap_response(
            resp,
            ok_type=PostApiPromptsResponse200,
            subject=f'handle="{handle}"',
            op="create",
        )
        if ok is None:
            raise RuntimeError(f"Failed to create prompt with handle={handle}")

        # Convert response to expected format for Prompt class
        converted = _convert_api_response_to_get_format(ok)
        return Prompt(converted)

    def update(
        self,
        prompt_id_or_handle: str,
        scope: Literal["PROJECT", "ORGANIZATION"],
        handle: Optional[str] = None,
        prompt: Optional[str] = None,
        messages: Optional[List[MessageDict]] = None,
        inputs: Optional[List[InputDict]] = None,
        outputs: Optional[List[OutputDict]] = None,
    ) -> Prompt:
        """
        Update an existing prompt with clean dictionary interfaces.

        Args:
            prompt_id_or_handle: ID or handle of the prompt to update
            scope: Scope of the prompt
            handle: New handle for the prompt
            prompt: New prompt text content
            messages: New list of message dicts
            inputs: New list of input dicts
            outputs: New list of output dicts

        Returns:
            Prompt object containing the updated prompt data
        """
        # Convert dicts to API models using from_dict
        api_messages = UNSET
        if messages:
            api_messages = [
                PutApiPromptsByIdBodyMessagesItem.from_dict(msg) for msg in messages
            ]

        api_inputs = UNSET
        if inputs:
            api_inputs = [
                PutApiPromptsByIdBodyInputsItem.from_dict(inp) for inp in inputs
            ]

        api_outputs = UNSET
        if outputs:
            api_outputs = [
                PutApiPromptsByIdBodyOutputsItem.from_dict(out) for out in outputs
            ]

        body = PutApiPromptsByIdBody(
            handle=handle or UNSET,
            scope=PutApiPromptsByIdBodyScope[scope],
            prompt=prompt or UNSET,
            messages=api_messages,
            inputs=api_inputs,
            outputs=api_outputs,
        )

        resp = put_api_prompts_by_id.sync_detailed(
            id=prompt_id_or_handle,
            client=self._client,
            body=body,
        )

        ok = unwrap_response(
            resp,
            ok_type=PutApiPromptsByIdResponse200,
            subject=f'id="{prompt_id_or_handle}"',
            op="update",
        )
        if ok is None:
            raise RuntimeError(f"Failed to update prompt with id={prompt_id_or_handle}")

        # Convert response to expected format for Prompt class
        converted = _convert_api_response_to_get_format(ok)
        return Prompt(converted)

    def delete(self, prompt_id: str) -> Dict[str, bool]:
        """Delete a prompt by its ID."""
        resp = delete_api_prompts_by_id.sync_detailed(id=prompt_id, client=self._client)
        ok = unwrap_response(
            resp,
            ok_type=DeleteApiPromptsByIdResponse200,
            subject=f'id="{prompt_id}"',
            op="delete",
        )
        if ok is None:
            raise RuntimeError(f"Failed to delete prompt with id={prompt_id}")
        return {"success": bool(ok.success)}
