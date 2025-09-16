"""
Pytest configuration and shared fixtures.

This file makes fixtures available to all test files in the tests directory
according to pytest's fixture discovery mechanism.
"""

# Import all fixtures to make them available to test files
from fixtures.prompts.cli import cli_prompt_setup
from fixtures.prompts.general import empty_dir, clean_langwatch
from fixtures import GetPromptResponseFactory

__all__ = [
    "cli_prompt_setup",
    "empty_dir",
    "clean_langwatch",
    "GetPromptResponseFactory",
]
