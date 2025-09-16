"""
Local prompt file loader for LangWatch Python SDK.

Reads prompts from local files in the CLI format:
- prompts.json: Configuration file
- prompts-lock.json: Lock file with materialized paths
- *.prompt.yaml: Individual prompt files
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional, Dict, Any
import warnings

import yaml

from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item import (
    GetApiPromptsByIdResponse200MessagesItem,
)
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200_messages_item_role import (
    GetApiPromptsByIdResponse200MessagesItemRole,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200_scope import (
    PostApiPromptsResponse200Scope,
)

logger = logging.getLogger(__name__)


class LocalPromptLoader:
    """Loads prompts from local files in CLI format."""

    def __init__(self, base_path: Optional[Path] = None):
        """Initialize with base path (defaults to current working directory)."""
        self.base_path = base_path or Path.cwd()

    def load_prompt(self, prompt_id: str) -> Optional[GetApiPromptsByIdResponse200]:
        """
        Load a prompt from local files.

        Returns None if prompt not found locally.
        """
        try:
            # Check if prompts.json exists
            prompts_json_path = self.base_path / "prompts.json"
            if not prompts_json_path.exists():
                logger.debug(
                    f"No prompts.json found at {prompts_json_path}, falling back to API"
                )
                return None

            # Load prompts.json
            try:
                with open(prompts_json_path, "r") as f:
                    prompts_config = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                warnings.warn(
                    f"Failed to read prompts.json at {prompts_json_path}: {e}. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            # Check if prompt exists in config
            if prompt_id not in prompts_config.get("prompts", {}):
                logger.debug(
                    f"Prompt '{prompt_id}' not found in prompts.json, falling back to API"
                )
                return None

            # Load prompts-lock.json to get materialized path
            prompts_lock_path = self.base_path / "prompts-lock.json"
            if not prompts_lock_path.exists():
                warnings.warn(
                    f"prompts.json exists but prompts-lock.json not found at {prompts_lock_path}. "
                    f"Run 'langwatch prompts pull' to sync local prompts. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            try:
                with open(prompts_lock_path, "r") as f:
                    prompts_lock = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                warnings.warn(
                    f"Failed to read prompts-lock.json at {prompts_lock_path}: {e}. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            # Get materialized path
            prompt_info = prompts_lock.get("prompts", {}).get(prompt_id)
            if not prompt_info:
                warnings.warn(
                    f"Prompt '{prompt_id}' found in prompts.json but not in prompts-lock.json. "
                    f"Run 'langwatch prompts pull' to sync local prompts. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            materialized_path = prompt_info.get("materialized")
            if not materialized_path:
                warnings.warn(
                    f"Prompt '{prompt_id}' in prompts-lock.json has no materialized path. "
                    f"Run 'langwatch prompts pull' to sync local prompts. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            # Load the actual prompt file
            prompt_file_path = self.base_path / materialized_path
            if not prompt_file_path.exists():
                warnings.warn(
                    f"Prompt file not found at {prompt_file_path}. "
                    f"Run 'langwatch prompts pull' to sync local prompts. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            try:
                with open(prompt_file_path, "r") as f:
                    prompt_data = yaml.safe_load(f)
            except (yaml.YAMLError, OSError) as e:
                warnings.warn(
                    f"Failed to parse prompt file at {prompt_file_path}: {e}. "
                    f"Falling back to API for prompt '{prompt_id}'.",
                    UserWarning,
                )
                return None

            # Convert to API response format
            logger.info(
                f"Successfully loaded prompt '{prompt_id}' from local file: {prompt_file_path}"
            )
            return self._convert_to_api_response(prompt_id, prompt_data, prompt_info)

        except Exception as e:
            # If any unexpected error occurs, warn and fall back to API
            warnings.warn(
                f"Unexpected error loading prompt '{prompt_id}' from local files: {e}. "
                f"Falling back to API.",
                UserWarning,
            )
            return None

    def _convert_to_api_response(
        self, prompt_id: str, prompt_data: Dict[str, Any], prompt_info: Dict[str, Any]
    ) -> GetApiPromptsByIdResponse200:
        """Convert local prompt data to API response format."""

        # Convert messages
        messages = []
        for msg in prompt_data.get("messages", []):
            role_str = msg.get("role", "").lower()  # Use lowercase to match enum values
            role = GetApiPromptsByIdResponse200MessagesItemRole(role_str)
            messages.append(
                GetApiPromptsByIdResponse200MessagesItem(
                    role=role, content=msg.get("content", "")
                )
            )

        # Create response object
        return GetApiPromptsByIdResponse200(
            id=prompt_id,
            handle=prompt_id,
            scope=PostApiPromptsResponse200Scope.PROJECT,
            name=prompt_id,
            updated_at="2023-01-01T00:00:00Z",
            project_id="local",
            organization_id="local",
            version_id=prompt_info.get("versionId", "local"),
            version=prompt_info.get("version", 0),
            created_at="2023-01-01T00:00:00Z",
            prompt=prompt_data.get("prompt", ""),
            messages=messages,
            inputs=[],
            outputs=[],
            model=prompt_data.get("model", "gpt-4"),
        )
