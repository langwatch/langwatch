"""
Core PromptData structure for prompts.

This module contains only the PromptData TypedDict with conversion methods,
following the TypeScript PromptData interface structure.
"""

from typing import TypedDict, Literal, Optional, List, Union

from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_response_200 import (
    PutApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)

from .structures import MessageDict, ResponseFormatDict


class PromptData(TypedDict, total=False):
    """
    Core data structure for prompts, matching the TypeScript PromptData interface.

    Contains both core functionality fields and optional metadata for identification/tracing.
    """

    # === Core functionality (required) ===
    model: str
    messages: List[MessageDict]  # Use standardized message structure

    # === Optional core fields ===
    prompt: Optional[str]
    temperature: Optional[float]
    max_tokens: Optional[int]  # Note: using snake_case to match Python conventions
    response_format: Optional[ResponseFormatDict]  # Use standardized response format

    # === Optional identification (for tracing) ===
    id: Optional[str]
    handle: Optional[str]
    version: Optional[int]
    version_id: Optional[str]
    scope: Optional[Literal["PROJECT", "ORGANIZATION"]]

    @staticmethod
    def from_api_response(
        response: Union[
            GetApiPromptsByIdResponse200,
            PutApiPromptsByIdResponse200,
            PostApiPromptsResponse200,
        ],
    ) -> "PromptData":
        """
        Create PromptData from API response object.

        Args:
            response: GetApiPromptsByIdResponse200 object from API

        Returns:
            PromptData dictionary with converted fields
        """
        # Import standardized structures here to avoid circular imports
        from .structures import MessageDict, ResponseFormatDict

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
