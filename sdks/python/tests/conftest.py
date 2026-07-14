"""
Pytest configuration and shared fixtures.

This file makes fixtures available to all test files in the tests directory
according to pytest's fixture discovery mechanism.
"""

# Import all fixtures to make them available to test files
from fixtures import (
    GetPromptResponseFactory,
    cli_prompt_setup,
    empty_dir,
    clean_langwatch,
    mock_config,
    prompt_data,
    prompt,
    mock_api_response_for_tracing,
)

__all__ = [
    "GetPromptResponseFactory",
    "cli_prompt_setup",
    "empty_dir",
    "clean_langwatch",
    "mock_config",
    "prompt_data",
    "prompt",
    "mock_api_response_for_tracing",
]
