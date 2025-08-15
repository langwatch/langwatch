from typing import TypedDict, Literal, Optional, Dict, Any


# Clean TypedDict interfaces that match the expected API
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
