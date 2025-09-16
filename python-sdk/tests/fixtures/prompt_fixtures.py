# tests/fixtures/prompt_fixtures.py
import pytest
import tempfile
import json
import os
from pathlib import Path

import langwatch


@pytest.fixture
def cli_prompt_setup():
    """
    Fixture that creates a temporary directory with CLI-format prompt files.
    Returns the temp directory path and handles cleanup.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create files exactly like the TypeScript CLI does

        # 1. Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # 2. Create prompts-lock.json
        lock = {
            "prompts": {
                "my-prompt": {
                    "version": 0,
                    "versionId": "local",
                    "materialized": "prompts/my-prompt.prompt.yaml",
                }
            }
        }
        (temp_path / "prompts-lock.json").write_text(json.dumps(lock))

        # 3. Create the prompt file in exact CLI format
        prompts_dir = temp_path / "prompts"
        prompts_dir.mkdir()

        # Exact format from CLI create command
        prompt_content = """model: openai/gpt-4
modelParameters:
  temperature: 0.7
messages:
  - role: system
    content: You are a helpful assistant.
  - role: user
    content: "{{input}}"
"""
        (prompts_dir / "my-prompt.prompt.yaml").write_text(prompt_content)

        yield temp_path


@pytest.fixture
def empty_dir():
    """Fixture that provides an empty temporary directory."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def clean_langwatch():
    """Fixture that ensures langwatch is properly initialized and cleaned up for each test."""
    # Reset the global instance first
    from langwatch.state import set_instance

    set_instance(None)

    # Clear any cached prompts before test
    if "prompts" in langwatch.__dict__:
        del langwatch.__dict__["prompts"]

    # Setup langwatch client with test configuration
    langwatch.setup(api_key="test-api-key", endpoint_url="http://localhost:3000")

    yield

    # Clean up after test
    if "prompts" in langwatch.__dict__:
        del langwatch.__dict__["prompts"]

    # Reset the global instance
    set_instance(None)
