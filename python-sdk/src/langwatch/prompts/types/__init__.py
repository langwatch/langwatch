"""
Type definitions for the prompts module.

This module contains all type definitions used across the prompts system,
organized by their purpose and scope.
"""

# Core prompt data structure
from .prompt_data import PromptData

# API-related types
from .api import (
    MessageDict,
    InputDict,
    OutputDict,
    ResponseFormatDict,
)

__all__ = [
    # Core types
    "PromptData",
    # API types
    "MessageDict",
    "InputDict",
    "OutputDict",
    "ResponseFormatDict",
]
