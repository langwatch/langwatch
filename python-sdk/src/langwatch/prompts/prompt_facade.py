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


def parse_prompt_shorthand(input_str: str) -> Dict[str, Any]:
    """
    Parse a shorthand prompt reference string.

    Supported formats:
    - ``"pizza-prompt:production"`` -> slug with label
    - ``"pizza-prompt:2"`` -> slug with version (positive integer)
    - ``"pizza-prompt"`` -> bare slug
    - ``"pizza-prompt:latest"`` -> treated as bare slug (no-op)
    - ``"my-org/prompt:staging"`` -> slug with slash preserved

    Args:
        input_str: The shorthand string to parse.

    Returns:
        Dict with keys: slug (str), label (Optional[str]), version (Optional[int]).

    Raises:
        ValueError: If the slug portion is empty.
    """
    colon_index = input_str.rfind(":")

    if colon_index == -1:
        return {"slug": input_str, "label": None, "version": None}

    slug = input_str[:colon_index]
    suffix = input_str[colon_index + 1:]

    if len(slug) == 0:
        raise ValueError(
            f'Invalid format: slug must not be empty. Received "{input_str}"'
        )

    if suffix == "latest":
        return {"slug": slug, "label": None, "version": None}

    try:
        parsed = int(suffix)
        if parsed > 0:
            return {"slug": slug, "label": None, "version": parsed}
    except ValueError:
        pass  # Not a valid integer — treat suffix as a label name

    return {"slug": slug, "label": suffix, "version": None}


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
        label: Optional[str] = None,
        fetch_policy: Optional[FetchPolicy] = None,
        cache_ttl_minutes: Optional[int] = None,
    ) -> Prompt:
        """
        Retrieve a prompt by its ID with configurable fetch policy.

        Supports shorthand syntax: ``"pizza-prompt:production"`` resolves to the
        version labeled "production". ``"pizza-prompt:2"`` resolves to version 2.

        Args:
            prompt_id: The prompt ID, handle, or shorthand (e.g., "slug:label").
            version_number: Optional specific version number to retrieve.
            label: Optional label to fetch (e.g., "production", "staging").
            fetch_policy: How to fetch the prompt. Defaults to MATERIALIZED_FIRST.
            cache_ttl_minutes: Cache TTL in minutes (only used with CACHE_TTL policy). Defaults to 5.

        Raises:
            ValueError: If conflicting shorthand and explicit options are provided.
            ValueError: If both version_number and label are specified.
            ValueError: If label is used with MATERIALIZED_ONLY policy.
            ValueError: If the prompt is not found (404 error).
            RuntimeError: If the API call fails for other reasons (auth, server errors, etc.).
        """
        shorthand = parse_prompt_shorthand(prompt_id)
        resolved_id = shorthand["slug"]
        has_shorthand_version = shorthand.get("version") is not None
        has_shorthand_label = shorthand.get("label") is not None

        # Conflict: shorthand carries version or label AND explicit options also specify version or label
        if (has_shorthand_version or has_shorthand_label) and (version_number is not None or label is not None):
            raise ValueError("Cannot combine shorthand with explicit version/label options")

        # Conflict: both explicit version AND explicit label
        if version_number is not None and label is not None:
            raise ValueError("Cannot specify both version and label")

        resolved_version = version_number if version_number is not None else shorthand.get("version")
        resolved_label = label if label is not None else shorthand.get("label")

        fetch_policy = fetch_policy or FetchPolicy.MATERIALIZED_FIRST

        if resolved_label is not None and fetch_policy == FetchPolicy.MATERIALIZED_ONLY:
            raise ValueError(
                "Label-based fetch requires API access; incompatible with MATERIALIZED_ONLY policy"
            )

        if fetch_policy == FetchPolicy.MATERIALIZED_ONLY:
            return self._get_materialized_only(resolved_id)
        elif fetch_policy == FetchPolicy.ALWAYS_FETCH:
            return self._get_always_fetch(resolved_id, resolved_version, resolved_label)
        elif fetch_policy == FetchPolicy.CACHE_TTL:
            return self._get_cache_ttl(
                resolved_id, resolved_version, resolved_label, cache_ttl_minutes or 5
            )
        else:  # MATERIALIZED_FIRST (default)
            return self._get_materialized_first(resolved_id, resolved_version, resolved_label)

    def _get_materialized_first(
        self,
        prompt_id: str,
        version_number: Optional[int] = None,
        label: Optional[str] = None,
    ) -> Prompt:
        """Get prompt using MATERIALIZED_FIRST policy (local first, API fallback).

        When a label is provided, skips local loading and fetches directly from API
        since labels require API access to resolve.
        """
        # When label is provided, skip local and go straight to API
        if label is None:
            local_data = self._local_loader.load_prompt(prompt_id)
            if local_data is not None:
                return Prompt(local_data)

        # Fall back to API if not found locally (or label was provided)
        api_data = self._api_service.get(prompt_id, version_number, label=label)
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
        label: Optional[str] = None,
    ) -> Prompt:
        """Get prompt using ALWAYS_FETCH policy (API first, local fallback)."""
        try:
            api_data = self._api_service.get(prompt_id, version_number, label=label)
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
        label: Optional[str] = None,
        cache_ttl_minutes: int = 5,
    ) -> Prompt:
        """Get prompt using CACHE_TTL policy (cache with TTL, fallback to local)."""
        cache_key = f"{prompt_id}::version:{version_number or ''}::label:{label or ''}"
        ttl_ms = cache_ttl_minutes * 60 * 1000
        now = time.time() * 1000  # Convert to milliseconds

        cached = self._cache.get(cache_key)
        if cached and now - cached["timestamp"] < ttl_ms:
            return Prompt(cached["data"])

        try:
            api_data = self._api_service.get(prompt_id, version_number, label=label)
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
                    "label": label,
                    "cache_ttl_minutes": cache_ttl_minutes,
                },
            )
            # Fall back to local if API fails
            local_data = self._local_loader.load_prompt(prompt_id)
            if local_data is not None:
                return Prompt(local_data)
            raise ValueError(f"Prompt '{prompt_id}' not found locally or on server")

    @property
    def labels(self) -> "PromptLabelsNamespace":
        """Access the labels sub-resource for assigning labels to prompt versions."""
        return PromptLabelsNamespace(self._api_service)

    def create(
        self,
        handle: str,
        author_id: Optional[str] = None,
        scope: Literal["PROJECT", "ORGANIZATION"] = "PROJECT",
        prompt: Optional[str] = None,
        messages: Optional[List[MessageDict]] = None,
        inputs: Optional[List[InputDict]] = None,
        outputs: Optional[List[OutputDict]] = None,
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
            labels=labels,
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

        Returns:
            Prompt object containing the updated prompt data
        """
        data = self._api_service.update(
            prompt_id_or_handle=prompt_id_or_handle,
            scope=scope,
            commit_message=commit_message,
            handle=handle,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            labels=labels,
        )
        return Prompt(data)

    def delete(self, prompt_id: str) -> Dict[str, bool]:
        """Delete a prompt by its ID via API."""
        return self._api_service.delete(prompt_id)


class PromptLabelsNamespace:
    """Lightweight namespace for label assignment operations on prompts."""

    def __init__(self, api_service: PromptApiService):
        self._api_service = api_service

    def assign(
        self,
        prompt_id: str,
        *,
        label: str,
        version_id: str,
    ) -> Dict[str, str]:
        """
        Assign a label to a specific prompt version.

        Args:
            prompt_id: The prompt ID or handle
            label: The label to assign ("production" or "staging")
            version_id: The version ID to assign the label to

        Returns:
            Dictionary with assignment details (configId, versionId, label, updatedAt)
        """
        return self._api_service.assign_label(prompt_id, label, version_id)
