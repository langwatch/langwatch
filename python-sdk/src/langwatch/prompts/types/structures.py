"""
API-related types and structures for prompts.

Contains Pydantic models that match the API structure for messages,
inputs, outputs, and response formats.
"""

from typing import Literal, Optional, Dict, Any

from pydantic import BaseModel


class Message(BaseModel):
    """Message model that matches the API structure."""

    role: Literal["system", "user", "assistant"]
    content: str


class Input(BaseModel):
    """Input model that matches the API structure."""

    identifier: str
    type: Literal["str", "int", "float", "bool", "json"]


class Output(BaseModel):
    """Output model that matches the API structure."""

    identifier: str
    type: Literal["str", "int", "float", "bool", "json"]
    json_schema: Optional[Dict[str, Any]] = None


class ResponseFormat(BaseModel):
    """Response format model for structured outputs."""

    type: Literal["json_schema"]
    json_schema: Optional[Dict[str, Any]] = None


class PromptTag(BaseModel):
    """
    Tag pointing at a specific prompt version.

    Mirrors the server-side apiResponsePromptTagSchema: a tag's name plus the
    versionId it currently resolves to. The built-in "latest" tag is included
    when the response represents the prompt's latest version.
    """

    name: str
    version_id: str


# Backward compatibility aliases
MessageDict = Message
InputDict = Input
OutputDict = Output
ResponseFormatDict = ResponseFormat
