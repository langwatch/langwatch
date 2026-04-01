# src/langwatch/prompts/service.py
"""
Facade service for managing LangWatch prompts with guaranteed availability.

This module provides a high-level interface that tries local file loading first,
then falls back to API operations. This ensures prompts work even when offline
or when API is unavailable.

Follows the facade pattern to coordinate between LocalPromptLoader and PromptApiService.
"""
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
import time
import warnings
from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)

from langwatch.utils.initialization import ensure_setup
from langwatch.state import get_instance
from .prompt import Prompt
from .types import FetchPolicy
from .prompt_api_service import PromptApiService
from .local_loader import LocalPromptLoader
from .types import Message, Input, Output, MessageDict, InputDict, OutputDict
from logging import getLogger

logger = getLogger(__name__)


class PromptsFacade:
    """
    Facade service for managing LangWatch prompts with guaranteed availability.

    Provides CRUD operations for prompts with local-first loading and API fallback.
    Coordinates between LocalPromptLoader and PromptApiService to ensure prompts
    work even when offline or when API is unavailable.
    """

    def __init__(
        self,
        rest_api_client: LangWatchRestApiClient,
        prompts_path: Optional[str] = None,
    ):
        """Initialize the prompt service facade with dependencies."""
        self._api_service = PromptApiService(rest_api_client)
        self._local_loader = LocalPromptLoader(
            base_path=Path(prompts_path) if prompts_path else None
        )
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
        return cls(instance.rest_api_client, prompts_path=instance.prompts_path)

    def get(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        fetch_policy: Optional[FetchPolicy] = None,
        cache_ttl_minutes: Optional[int] = None,
        tag: Optional[str] = None,
    ) -> Prompt:
        """
        Retrieve a prompt by its ID with configurable fetch policy.

        Args:
            prompt_id: The prompt ID to retrieve. Pass the full string through to the API
                (e.g. "my-prompt" or "my-prompt:production").
            version_number: Optional specific version number to retrieve.
            fetch_policy: How to fetch the prompt. Defaults to MATERIALIZED_FIRST.
            cache_ttl_minutes: Cache TTL in minutes (only used with CACHE_TTL policy). Defaults to 5.
            tag: Optional tag to fetch a specific tagged version (e.g. "production", "staging").

        Raises:
            ValueError: If the prompt is not found (404 error).
            RuntimeError: If the API call fails for other reasons (auth, server errors, etc.).
        """
        fetch_policy = fetch_policy or FetchPolicy.MATERIALIZED_FIRST

        if fetch_policy == FetchPolicy.MATERIALIZED_ONLY:
            return self._get_materialized_only(prompt_id)
        elif fetch_policy == FetchPolicy.ALWAYS_FETCH:
            return self._get_always_fetch(prompt_id, version_number, tag)
        elif fetch_policy == FetchPolicy.CACHE_TTL:
            return self._get_cache_ttl(
                prompt_id, version_number, cache_ttl_minutes or 5, tag
            )
        else:  # MATERIALIZED_FIRST (default)
            return self._get_materialized_first(prompt_id, version_number, tag)

    def _get_materialized_first(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        tag: Optional[str] = None,
    ) -> Prompt:
        """Get prompt using MATERIALIZED_FIRST policy (local first, API fallback).

        When a tag is provided, skips local loading and fetches directly from API
        since tags require API access to resolve.
        """
        # When tag is provided, skip local and go straight to API
        if tag is None:
            local_data = self._local_loader.load_prompt(prompt_id)
            if local_data is not None:
                return Prompt(local_data)

        # Fall back to API if not found locally (or tag was provided)
        api_data = self._api_service.get(prompt_id, version_number, tag=tag)
        return Prompt(api_data)

    def _get_materialized_only(self, prompt_id: str) -> Prompt:
        """Get prompt using MATERIALIZED_ONLY policy (local only, no API calls)."""
        local_data = self._local_loader.load_prompt(prompt_id)
        if local_data is not None:
            return Prompt(local_data)

        raise ValueError(f"Prompt '{prompt_id}' not found in materialized files")

    def _get_always_fetch(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        tag: Optional[str] = None,
    ) -> Prompt:
        """Get prompt using ALWAYS_FETCH policy (API first, local fallback)."""
        try:
            api_data = self._api_service.get(prompt_id, version_number, tag=tag)
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
        tag: Optional[str] = None,
    ) -> Prompt:
        """Get prompt using CACHE_TTL policy (cache with TTL, fallback to local)."""
        cache_key = f"{prompt_id}::version:{version_number or ''}::tag:{tag or ''}"
        ttl_ms = cache_ttl_minutes * 60 * 1000
        now = time.time() * 1000  # Convert to milliseconds

        cached = self._cache.get(cache_key)
        if cached and now - cached["timestamp"] < ttl_ms:
            return Prompt(cached["data"])

        try:
            api_data = self._api_service.get(prompt_id, version_number, tag=tag)
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
                    "tag": tag,
                },
            )
            # Fall back to local if API fails
            local_data = self._local_loader.load_prompt(prompt_id)
            if local_data is not None:
                return Prompt(local_data)
            raise ValueError(f"Prompt '{prompt_id}' not found locally or on server")

    @property
    def tags(self) -> "PromptTagsNamespace":
        """Access the tags sub-resource for assigning tags to prompt versions."""
        return PromptTagsNamespace(self._api_service)

    @property
    def labels(self) -> "PromptTagsNamespace":
        """Backward-compatible alias for the tags sub-resource.

        .. deprecated::
            Use ``tags`` instead. This alias will be removed in a future release.
        """
        return PromptTagsNamespace(self._api_service)

    def create(
        self,
        handle: str,
        author_id: Optional[str] = None,
        scope: Literal["PROJECT", "ORGANIZATION"] = "PROJECT",
        prompt: Optional[str] = None,
        messages: Optional[List[MessageDict]] = None,
        inputs: Optional[List[InputDict]] = None,
        outputs: Optional[List[OutputDict]] = None,
        tags: Optional[List[str]] = None,
        labels: Optional[List[str]] = None,
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
            tags: Optional list of tags to assign to the initial version
            labels: Deprecated alias for tags. Use ``tags`` instead.

        Returns:
            Prompt object containing the created prompt data
        """
        resolved_tags = _resolve_tags(tags=tags, labels=labels)
        data = self._api_service.create(
            handle=handle,
            author_id=author_id,
            scope=scope,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            tags=resolved_tags,
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
        tags: Optional[List[str]] = None,
        labels: Optional[List[str]] = None,
        *,
        commit_message: str = "",
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
            tags: Optional list of tags to assign to the new version
            labels: Deprecated alias for tags. Use ``tags`` instead.

        Returns:
            Prompt object containing the updated prompt data
        """
        resolved_tags = _resolve_tags(tags=tags, labels=labels)
        data = self._api_service.update(
            prompt_id_or_handle=prompt_id_or_handle,
            scope=scope,
            commit_message=commit_message,
            handle=handle,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            tags=resolved_tags,
        )
        return Prompt(data)

    def delete(self, prompt_id: str) -> Dict[str, bool]:
        """Delete a prompt by its ID via API."""
        return self._api_service.delete(prompt_id)


class PromptTagsNamespace:
    """Lightweight namespace for tag assignment operations on prompts."""

    def __init__(self, api_service: PromptApiService):
        self._api_service = api_service

    def assign(
        self,
        prompt_id: str,
        *,
        tag: Optional[str] = None,
        version_id: str,
        label: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Assign a tag to a specific prompt version.

        Args:
            prompt_id: The prompt ID or handle
            tag: The tag to assign (e.g. "production", "staging", or any custom tag)
            version_id: The version ID to assign the tag to
            label: Deprecated alias for tag. Use ``tag`` instead.

        Returns:
            Dictionary with assignment details (configId, versionId, tag, updatedAt)
        """
        resolved_tag = tag
        if resolved_tag is None and label is not None:
            warnings.warn(
                "The 'label' parameter is deprecated. Use 'tag' instead.",
                DeprecationWarning,
                stacklevel=2,
            )
            resolved_tag = label
        if resolved_tag is None:
            raise ValueError("Either 'tag' or 'label' must be provided")
        return self._api_service.assign_tag(prompt_id, resolved_tag, version_id)


def _resolve_tags(
    tags: Optional[List[str]] = None,
    labels: Optional[List[str]] = None,
) -> Optional[List[str]]:
    """Resolve tags from either ``tags`` or deprecated ``labels`` parameter.

    If ``labels`` is provided instead of ``tags``, emits a deprecation warning
    and uses the labels value.
    """
    if tags is not None:
        return tags
    if labels is not None:
        warnings.warn(
            "The 'labels' parameter is deprecated. Use 'tags' instead.",
            DeprecationWarning,
            stacklevel=3,
        )
        return labels
    return None
