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

from .types import PromptData, MessageDict, ResponseFormatDict

logger = logging.getLogger(__name__)


class LocalPromptLoader:
    """Loads prompts from local files in CLI format."""

    def __init__(self, base_path: Optional[Path] = None):
        """Initialize with base path (defaults to current working directory)."""
        self.base_path = base_path or Path.cwd()

    def load_prompt(self, prompt_id: str) -> Optional[PromptData]:
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

            # Build PromptData directly
            logger.info(
                f"Successfully loaded prompt '{prompt_id}' from local file: {prompt_file_path}"
            )

            # Convert messages
            messages = []
            if "messages" in prompt_data:
                messages = [
                    MessageDict(role=msg["role"], content=msg["content"])
                    for msg in prompt_data["messages"]
                ]

            # Convert response format if present
            response_format = None
            if "response_format" in prompt_data and prompt_data["response_format"]:
                response_format = ResponseFormatDict(
                    type="json_schema", json_schema=prompt_data["response_format"]
                )

            return PromptData(
                handle=prompt_id,  # The prompt_id parameter is the handle
                model=prompt_data["model"],  # Required field - let it fail if missing
                messages=messages,
                prompt=prompt_data.get("prompt"),
                temperature=prompt_data.get("temperature"),
                max_tokens=prompt_data.get("max_tokens"),
                response_format=response_format,
                version=prompt_info.get("version"),
                version_id=prompt_info.get("versionId"),
                # id and scope are not available in local files
            )

        except Exception as e:
            # If any unexpected error occurs, warn and fall back to API
            warnings.warn(
                f"Unexpected error loading prompt '{prompt_id}' from local files: {e}. "
                f"Falling back to API.",
                UserWarning,
            )
            return None
