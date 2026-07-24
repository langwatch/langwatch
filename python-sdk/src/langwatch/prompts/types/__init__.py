"""
Type definitions for the prompts module.

This module contains all type definitions used across the prompts system,
organized by their purpose and scope.
"""

# Core prompt data structure
from .prompt_data import PromptData

# Fetch policy
from .fetch_policy import FetchPolicy

# Standardized data structures
from .structures import (
    Message,
    Input,
    Output,
    ResponseFormat,
    # Backward compatibility aliases
    MessageDict,
    InputDict,
    OutputDict,
    ResponseFormatDict,
)

__all__ = [
    # Core types
    "PromptData",
    # Pydantic models
    "Message",
    "Input",
    "Output",
    "ResponseFormat",
    # Backward compatibility aliases
    "MessageDict",
    "InputDict",
    "OutputDict",
    "ResponseFormatDict",
    "FetchPolicy",
]
