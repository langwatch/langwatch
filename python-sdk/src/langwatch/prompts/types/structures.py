"""
API-related types and structures for prompts.

Contains TypedDict classes that match the API structure for messages,
inputs, outputs, and response formats.
"""

from typing import TypedDict, Literal, Optional, Dict, Any


class MessageDict(TypedDict):
    """Message dictionary that matches the API structure."""

    role: Literal["system", "user", "assistant"]
    content: str


class InputDict(TypedDict):
    """Input dictionary that matches the API structure."""

    identifier: str
    type: Literal["str", "int", "float", "bool", "json"]


class OutputDict(TypedDict):
    """Output dictionary that matches the API structure."""

    identifier: str
    type: Literal["str", "int", "float", "bool", "json"]
    json_schema: Optional[Dict[str, Any]]


class ResponseFormatDict(TypedDict, total=False):
    """Response format dictionary for structured outputs."""

    type: Literal["json_schema"]
    json_schema: Optional[Dict[str, Any]]
