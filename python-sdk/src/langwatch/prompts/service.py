# src/langwatch/prompt/service.py
"""
Service layer for managing LangWatch prompts via REST API.

This module provides a high-level interface for CRUD operations on prompts,
handling API communication, error handling, and response unwrapping.
"""
from typing import Dict, Literal
from langwatch.generated.langwatch_rest_api_client.types import UNSET, Unset
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

    @prompt_service_tracing.get
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

    @prompt_service_tracing.create
    def create(
        self,
        handle: str,
        author_id: str,
        scope: Literal["PROJECT", "ORGANIZATION"],
        prompt: str | Unset = UNSET,
        messages: list[PostApiPromptsBodyMessagesItem] | Unset = UNSET,
        inputs: list[PostApiPromptsBodyInputsItem] | Unset = UNSET,
        outputs: list[PostApiPromptsBodyOutputsItem] | Unset = UNSET,
    ) -> Prompt:
        """
        Create a new prompt with the specified parameters.

        Args:
            handle: Unique identifier for the prompt (required)
            name: Display name for the prompt
            scope: Scope of the prompt ('ORGANIZATION' or 'PROJECT', defaults to 'PROJECT')
            author_id: ID of the author
            prompt: The prompt text content
            messages: List of message objects with role and content
            inputs: List of input definitions with identifier and type
            outputs: List of output definitions with identifier, type, and optional json_schema

        Returns:
            Prompt object containing the created prompt data

        Raises:
            ValueError: If request is invalid (400)
            RuntimeError: For authentication (401) or server errors (5xx)
        """
        # Normalize author_id: None -> UNSET
        author_id_value = UNSET if author_id is None else author_id

        resp = post_api_prompts.sync_detailed(
            client=self._client,
            body=PostApiPromptsBody(
                handle=handle,
                scope=PostApiPromptsBodyScope(scope),
                author_id=author_id_value,
                prompt=prompt,
                messages=_normalize_messages(messages),
                inputs=_normalize_inputs(inputs),
                outputs=_normalize_outputs(outputs),
            ),
        )
        ok = unwrap_response(
            resp,
            ok_type=PostApiPromptsResponse200,
            subject=f'handle="{handle}"',
            op="create",
        )
        return Prompt(ok)

    def update(
        self,
        # base config data
        prompt_id: str,
        scope: Literal["PROJECT", "ORGANIZATION"],
        handle: str | Unset = UNSET,
        # version data
        prompt: str | Unset = UNSET,
        messages: list[PostApiPromptsBodyMessagesItem] | Unset = UNSET,
        inputs: list[PostApiPromptsBodyInputsItem] | Unset = UNSET,
        outputs: list[PostApiPromptsBodyOutputsItem] | Unset = UNSET,
    ) -> Prompt:
        """
        Update an existing prompt's properties.

        Note: After updating, fetches the latest prompt data to ensure consistency.
        This approach trades an extra API call for data accuracy.

        Args:
            prompt_id: Unique identifier for the prompt to update
            name: New name for the prompt
            handle: New handle for the prompt
            scope: New scope for the prompt ('ORGANIZATION' or 'PROJECT')

        Returns:
            Prompt object containing the updated prompt data

        Raises:
            ValueError: If prompt is not found (404) or request is invalid (400)
            RuntimeError: For authentication (401) or server errors (5xx)
        """
        resp = put_api_prompts_by_id.sync_detailed(
            id=prompt_id,
            client=self._client,
            # Name shouldn't be required here, but it is.
            body=PutApiPromptsByIdBody(
                name=name,
                handle=handle,
                scope=PutApiPromptsByIdBodyScope[scope],
                prompt=prompt,
                messages=_normalize_messages(messages),
                inputs=_normalize_inputs(inputs),
                outputs=_normalize_outputs(outputs),
            ),
        )
        unwrap_response(
            resp,
            ok_type=PutApiPromptsByIdResponse200,
            subject=f'id="{prompt_id}"',
            op="update",
        )
        return self.get(prompt_id)

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


def _normalize_messages(messages):
    """
    Normalize messages input to proper model instances.

    Accepts dict objects and converts them to PostApiPromptsBodyMessagesItem instances.
    """
    if messages is None or isinstance(messages, Unset):
        return UNSET

    result = []
    for m in messages:
        if isinstance(m, PostApiPromptsBodyMessagesItem):
            result.append(m)
        elif isinstance(m, dict):
            # Let model handle enum coercion (role)
            result.append(PostApiPromptsBodyMessagesItem.from_dict(m))
        else:
            raise TypeError(
                "messages items must be dict or PostApiPromptsBodyMessagesItem"
            )
    return result


def _normalize_inputs(inputs):
    """
    Normalize inputs to proper model instances.

    Accepts dict objects, converts friendly type names (string -> str),
    and creates PostApiPromptsBodyInputsItem instances.
    """
    if inputs is None or isinstance(inputs, Unset):
        return UNSET

    result = []
    for i in inputs:
        if isinstance(i, PostApiPromptsBodyInputsItem):
            result.append(i)
        elif isinstance(i, dict):
            d = dict(i)
            # Map friendly types to enum values
            if isinstance(d.get("type"), str):
                t = d["type"]
                if t == "string":
                    d["type"] = "str"
            result.append(PostApiPromptsBodyInputsItem.from_dict(d))
        else:
            raise TypeError("inputs items must be dict or PostApiPromptsBodyInputsItem")
    return result


def _normalize_outputs(outputs):
    """
    Normalize outputs to proper model instances.

    Accepts dict objects, converts friendly type names (string -> str),
    handles json_schema=None by removing it, and creates PostApiPromptsBodyOutputsItem instances.
    """
    if outputs is None or isinstance(outputs, Unset):
        return UNSET

    result = []
    for o in outputs:
        if isinstance(o, PostApiPromptsBodyOutputsItem):
            result.append(o)
        elif isinstance(o, dict):
            d = dict(o)
            # Map friendly types to enum values
            if isinstance(d.get("type"), str):
                t = d["type"]
                if t == "string":
                    d["type"] = "str"
            # Drop null json_schema (model expects unset or object)
            if "json_schema" in d and d["json_schema"] is None:
                d.pop("json_schema")
            result.append(PostApiPromptsBodyOutputsItem.from_dict(d))
        else:
            raise TypeError(
                "outputs items must be dict or PostApiPromptsBodyOutputsItem"
            )
    return result
