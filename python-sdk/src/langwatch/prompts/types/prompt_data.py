"""
Core PromptData structure for prompts.

This module contains only the PromptData TypedDict with conversion methods,
following the TypeScript PromptData interface structure.
"""

from typing import TypedDict, Literal, Optional, Dict, Any, List


class PromptData(TypedDict, total=False):
    """
    Core data structure for prompts, matching the TypeScript PromptData interface.

    Contains both core functionality fields and optional metadata for identification/tracing.
    """

    # === Core functionality (required) ===
    model: str
    messages: List[Dict[str, Any]]  # Generic dict to avoid importing API types

    # === Optional core fields ===
    prompt: Optional[str]
    temperature: Optional[float]
    max_tokens: Optional[int]  # Note: using snake_case to match Python conventions
    response_format: Optional[
        Dict[str, Any]
    ]  # Generic dict to avoid importing API types

    # === Optional identification (for tracing) ===
    id: Optional[str]
    handle: Optional[str]
    version: Optional[int]
    version_id: Optional[str]
    scope: Optional[Literal["PROJECT", "ORGANIZATION"]]

    @staticmethod
    def from_api_response(response) -> "PromptData":
        """
        Create PromptData from API response object.

        Args:
            response: GetApiPromptsByIdResponse200 object from API

        Returns:
            PromptData dictionary with converted fields
        """
        # Import API types here to avoid circular imports
        from .api import MessageDict, ResponseFormatDict

        messages = []
        if response.messages:
            messages = [
                MessageDict(role=msg.role.value, content=msg.content)
                for msg in response.messages
            ]

        # Convert response format if present
        response_format = None
        if hasattr(response, "response_format") and response.response_format:
            response_format = ResponseFormatDict(
                type="json_schema", json_schema=response.response_format
            )

        return PromptData(
            id=response.id,
            handle=response.handle,
            model=response.model,
            messages=messages,
            prompt=response.prompt,
            temperature=response.temperature,
            max_tokens=response.max_tokens,
            response_format=response_format,
            version=response.version,
            version_id=response.version_id,
            scope=response.scope.value if response.scope else None,
        )

    @staticmethod
    def from_local_file(
        prompt_id: str, prompt_data: Dict[str, Any], prompt_info: Dict[str, Any]
    ) -> "PromptData":
        """
        Create PromptData from local file data.

        Args:
            prompt_id: The prompt identifier
            prompt_data: Raw prompt data from YAML file
            prompt_info: Metadata from prompts-lock.json

        Returns:
            PromptData dictionary with converted fields
        """
        # Import API types here to avoid circular imports
        from .api import MessageDict, ResponseFormatDict

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
            id=prompt_id,
            handle=prompt_id,
            model=prompt_data.get("model", "gpt-4"),
            messages=messages,
            prompt=prompt_data.get("prompt"),
            temperature=prompt_data.get("temperature"),
            max_tokens=prompt_data.get("max_tokens"),
            response_format=response_format,
            version=prompt_info.get("version", 0),
            version_id=prompt_info.get("versionId", "local"),
            scope="PROJECT",
        )
