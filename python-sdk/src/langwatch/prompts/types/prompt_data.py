from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from langwatch.generated.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from langwatch.generated.models.post_api_prompts_response_200 import (
    PostApiPromptsResponse200,
)
from langwatch.generated.models.put_api_prompts_by_id_response_200 import (
    PutApiPromptsByIdResponse200,
)
from langwatch.generated.types import Unset


class ResponseFormat(BaseModel):
    """Response format configuration for structured outputs."""

    type: str
    json_schema: Optional[Any] = None


class Message(BaseModel):
    """A chat message with role and content."""

    role: Literal["system", "user", "assistant"]
    content: str


class PromptData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # === Core functionality (required) ===
    model: str = ""
    messages: List[Message] = Field(default_factory=list)

    # === Optional core fields ===
    prompt: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    response_format: Optional[ResponseFormat] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)

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
        raw_parameters = _read_runtime_parameters(response)

        return PromptData(
            id=_unset_to_none(response.id),
            handle=_unset_to_none(response.handle),
            model=response.model,
            messages=messages,
            prompt=_unset_to_none(response.prompt),
            temperature=_unset_to_none(response.temperature),
            max_tokens=_unset_to_none(response.max_tokens),
            response_format=response_format,
            parameters=raw_parameters,
            version=int(raw_version) if raw_version is not None else None,
            version_id=_unset_to_none(response.version_id),
            scope=response.scope.value if response.scope and not isinstance(response.scope, Unset) else None,
        )


def _read_runtime_parameters(response: object) -> Dict[str, Any]:
    additional_properties = getattr(response, "additional_properties", None)
    if isinstance(additional_properties, dict):
        params = additional_properties.get("parameters")
    else:
        params = getattr(response, "__dict__", {}).get("parameters")

    if isinstance(params, Unset) or params is None:
        return {}
    if isinstance(params, dict):
        return params
    return {}
