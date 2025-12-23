# src/langwatch/prompts/service.py
"""
Facade service for managing LangWatch prompts with guaranteed availability.

This module provides a high-level interface that tries local file loading first,
then falls back to API operations. This ensures prompts work even when offline
or when API is unavailable.

Follows the facade pattern to coordinate between LocalPromptLoader and PromptApiService.
"""
from typing import Any, Dict, List, Literal, Optional
import time
from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)

from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from .prompt import Prompt
from .types import FetchPolicy
from .prompt_api_service import PromptApiService
from .local_loader import LocalPromptLoader
from .types import MessageDict, InputDict, OutputDict
from logging import getLogger

logger = getLogger(__name__)


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
        self._cache: Dict[str, Dict[str, Any]] = {}

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

    def get(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        fetch_policy: Optional[FetchPolicy] = None,
        cache_ttl_minutes: Optional[int] = None,
    ) -> Prompt:
        """
        Retrieve a prompt by its ID with configurable fetch policy.

        Args:
            prompt_id: The prompt ID to retrieve
            version_number: Optional specific version number to retrieve
            fetch_policy: How to fetch the prompt. Defaults to MATERIALIZED_FIRST.
            cache_ttl_minutes: Cache TTL in minutes (only used with CACHE_TTL policy). Defaults to 5.

        Raises:
            ValueError: If the prompt is not found (404 error).
            RuntimeError: If the API call fails for other reasons (auth, server errors, etc.).
        """
        fetch_policy = fetch_policy or FetchPolicy.MATERIALIZED_FIRST

        if fetch_policy == FetchPolicy.MATERIALIZED_ONLY:
            return self._get_materialized_only(prompt_id)
        elif fetch_policy == FetchPolicy.ALWAYS_FETCH:
            return self._get_always_fetch(prompt_id, version_number)
        elif fetch_policy == FetchPolicy.CACHE_TTL:
            return self._get_cache_ttl(
                prompt_id, version_number, cache_ttl_minutes or 5
            )
        else:  # MATERIALIZED_FIRST (default)
            return self._get_materialized_first(prompt_id, version_number)

    def _get_materialized_first(
        self, prompt_id: str, version_number: Optional[int] = None
    ) -> Prompt:
        """Get prompt using MATERIALIZED_FIRST policy (local first, API fallback)."""
        # Try to load from local files first
        local_data = self._local_loader.load_prompt(prompt_id)
        if local_data is not None:
            return Prompt(local_data)

        # Fall back to API if not found locally
        api_data = self._api_service.get(prompt_id, version_number)
        return Prompt(api_data)

    def _get_materialized_only(self, prompt_id: str) -> Prompt:
        """Get prompt using MATERIALIZED_ONLY policy (local only, no API calls)."""
        local_data = self._local_loader.load_prompt(prompt_id)
        if local_data is not None:
            return Prompt(local_data)

        raise ValueError(f"Prompt '{prompt_id}' not found in materialized files")

    def _get_always_fetch(
        self, prompt_id: str, version_number: Optional[int] = None
    ) -> Prompt:
        """Get prompt using ALWAYS_FETCH policy (API first, local fallback)."""
        try:
            api_data = self._api_service.get(prompt_id, version_number)
            return Prompt(api_data)
        except Exception:
            # Fall back to local if API fails
            local_data = self._local_loader.load_prompt(prompt_id)
            if local_data is not None:
                return Prompt(local_data)
            raise ValueError(f"Prompt '{prompt_id}' not found locally or on server")

    def _get_cache_ttl(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        cache_ttl_minutes: int = 5,
    ) -> Prompt:
        """Get prompt using CACHE_TTL policy (cache with TTL, fallback to local)."""
        cache_key = f"{prompt_id}::version:{version_number or ''}"
        ttl_ms = cache_ttl_minutes * 60 * 1000
        now = time.time() * 1000  # Convert to milliseconds

        cached = self._cache.get(cache_key)
        if cached and now - cached["timestamp"] < ttl_ms:
            return Prompt(cached["data"])

        try:
            api_data = self._api_service.get(prompt_id, version_number)
            self._cache[cache_key] = {"data": api_data, "timestamp": now}
            return Prompt(api_data)
        except Exception:
            logger.warning(
                f"Failed to fetch prompt '{prompt_id}' from API, falling back to local",
                exc_info=True,
                stack_info=True,
                extra={
                    "prompt_id": prompt_id,
                    "version_number": version_number,
                    "cache_ttl_minutes": cache_ttl_minutes,
                },
            )
            # Fall back to local if API fails
            local_data = self._local_loader.load_prompt(prompt_id)
            if local_data is not None:
                return Prompt(local_data)
            raise ValueError(f"Prompt '{prompt_id}' not found locally or on server")

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
