# src/langwatch/prompts/service.py
"""
Facade service for managing LangWatch prompts with guaranteed availability.

This module provides a high-level interface that tries local file loading first,
then falls back to API operations. This ensures prompts work even when offline
or when API is unavailable.

Follows the facade pattern to coordinate between LocalPromptLoader and PromptApiService.
"""
from typing import Dict, List, Literal, Optional
from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)

from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from .prompt import Prompt
from .prompt_api_service import PromptApiService
from .local_loader import LocalPromptLoader
from .types import MessageDict, InputDict, OutputDict


class PromptsFacade:
    """
    Facade service for managing LangWatch prompts with guaranteed availability.

    Provides CRUD operations for prompts with local-first loading and API fallback.
    Coordinates between LocalPromptLoader and PromptApiService to ensure prompts
    work even when offline or when API is unavailable.
    """

    def __init__(self, rest_api_client: LangWatchRestApiClient):
        """Initialize the prompt service facade with dependencies."""
        self._api_service = PromptApiService(rest_api_client)
        self._local_loader = LocalPromptLoader()

    @classmethod
    def from_global(cls) -> "PromptsFacade":
        """Create a PromptsFacade instance using the global LangWatch configuration."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def get(self, prompt_id: str, version_number: Optional[int] = None) -> Prompt:
        """
        Retrieve a prompt by its ID with guaranteed availability.

        Tries local files first, then falls back to API.
        You can optionally specify a version number to get a specific version of the prompt.
        """
        # Try to load from local files first
        local_data = self._local_loader.load_prompt(prompt_id)
        if local_data is not None:
            return Prompt(local_data)

        # Fall back to API if not found locally
        api_data = self._api_service.get(prompt_id, version_number)
        return Prompt(api_data)

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
        Create a new prompt via API.

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
        data = self._api_service.create(
            handle=handle,
            author_id=author_id,
            scope=scope,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
        )
        return Prompt(data)

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
        Update an existing prompt via API.

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
        data = self._api_service.update(
            prompt_id_or_handle=prompt_id_or_handle,
            scope=scope,
            handle=handle,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
        )
        return Prompt(data)

    def delete(self, prompt_id: str) -> Dict[str, bool]:
        """Delete a prompt by its ID via API."""
        return self._api_service.delete(prompt_id)
