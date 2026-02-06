"""
Core PromptData structure for prompts.

This module contains the PromptData Pydantic model with conversion methods,
following the TypeScript PromptData interface structure.
"""

from typing import Literal, Optional, List, Union

from pydantic import BaseModel, ConfigDict

from langwatch.generated.langwatch_rest_api_client.types import Unset
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.put_api_prompts_by_id_response_200 import (
    PutApiPromptsByIdResponse200,
)
from langwatch.generated.langwatch_rest_api_client.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)

from .structures import Message, ResponseFormat


class PromptData(BaseModel):
    """
    Core data structure for prompts, matching the TypeScript PromptData interface.

    Contains both core functionality fields and optional metadata for identification/tracing.
    """

    model_config = ConfigDict(extra="ignore")

    # === Core functionality (required) ===
    model: str = ""
    messages: List[Message] = []

    # === Optional core fields ===
    prompt: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    response_format: Optional[ResponseFormat] = None

    # === Optional identification (for tracing) ===
    id: Optional[str] = None
    handle: Optional[str] = None
    version: Optional[int] = None
    version_id: Optional[str] = None
    scope: Optional[Literal["PROJECT", "ORGANIZATION"]] = None

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
            response: API response object

        Returns:
            PromptData instance with converted fields
        """
        def _unset_to_none(value):
            """Convert UNSET sentinel values to None."""
            return None if isinstance(value, Unset) else value

        messages = []
        raw_messages = _unset_to_none(response.messages)
        if raw_messages:
            messages = [
                Message(role=msg.role.value, content=msg.content)
                for msg in raw_messages
            ]

        # Convert response format if present
        response_format = None
        raw_response_format = _unset_to_none(
            getattr(response, "response_format", None)
        )
        if raw_response_format:
            response_format = ResponseFormat(
                type="json_schema", json_schema=raw_response_format.json_schema
            )

        raw_version = _unset_to_none(response.version)

        return PromptData(
            id=_unset_to_none(response.id),
            handle=_unset_to_none(response.handle),
            model=response.model,
            messages=messages,
            prompt=_unset_to_none(response.prompt),
            temperature=_unset_to_none(response.temperature),
            max_tokens=_unset_to_none(response.max_tokens),
            response_format=response_format,
            version=int(raw_version) if raw_version is not None else None,
            version_id=_unset_to_none(response.version_id),
            scope=response.scope.value if response.scope and not isinstance(response.scope, Unset) else None,
        )
