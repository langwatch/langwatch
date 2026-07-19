"""
Tests for prompts_path configuration flowing through setup() to LocalPromptLoader.
"""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import langwatch
from langwatch.client import Client


def test_setup_prompts_path_flows_to_local_loader(clean_langwatch):
    """
    GIVEN langwatch.setup() is called with prompts_path parameter
    WHEN langwatch.prompts.get() is called
    THEN the LocalPromptLoader uses the configured path
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"test-prompt": "file:prompts/test-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # Create prompts-lock.json
        lock = {
            "prompts": {
                "test-prompt": {
                    "version": 1,
                    "versionId": "v1",
                    "materialized": "prompts/test-prompt.prompt.yaml",
                }
            }
        }
        (temp_path / "prompts-lock.json").write_text(json.dumps(lock))

        # Create the prompt file
        prompts_dir = temp_path / "prompts"
        prompts_dir.mkdir()
        prompt_content = """model: openai/gpt-4
messages:
  - role: system
    content: Test prompt from custom path
"""
        (prompts_dir / "test-prompt.prompt.yaml").write_text(prompt_content)

        # Setup langwatch with prompts_path
        langwatch.setup(
            api_key="test-api-key",
            prompts_path=str(temp_path),
        )

        # Block HTTP requests to ensure we're using local files
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = Exception("HTTP should not be called")

            result = langwatch.prompts.get("test-prompt")

            assert result is not None
            assert result.model == "openai/gpt-4"
            assert result.messages[0].content == "Test prompt from custom path"
            mock_request.assert_not_called()


def test_setup_prompts_path_stored_in_client():
    """
    GIVEN langwatch.setup() is called with prompts_path parameter
    WHEN the client is retrieved
    THEN the prompts_path is accessible on the client
    """
    # Reset client for clean test
    Client._reset_instance()

    try:
        langwatch.setup(
            api_key="test-api-key",
            prompts_path="/custom/prompts/path",
        )

        from langwatch.state import get_instance

        client = get_instance()
        assert client is not None
        assert client.prompts_path == "/custom/prompts/path"
    finally:
        Client._reset_instance()


def test_setup_without_prompts_path_defaults_to_none():
    """
    GIVEN langwatch.setup() is called without prompts_path parameter
    WHEN the client is retrieved
    THEN prompts_path is None (will use cwd at runtime)
    """
    # Reset client for clean test
    Client._reset_instance()

    try:
        langwatch.setup(api_key="test-api-key")

        from langwatch.state import get_instance

        client = get_instance()
        assert client is not None
        assert client.prompts_path is None
    finally:
        Client._reset_instance()


def test_prompts_path_update_on_second_setup():
    """
    GIVEN langwatch.setup() was called without prompts_path
    WHEN langwatch.setup() is called again with prompts_path
    THEN the prompts_path is updated
    """
    # Reset client for clean test
    Client._reset_instance()

    try:
        # First setup without prompts_path
        langwatch.setup(api_key="test-api-key")

        from langwatch.state import get_instance

        client = get_instance()
        assert client.prompts_path is None

        # Second setup with prompts_path
        langwatch.setup(
            api_key="test-api-key",
            prompts_path="/updated/path",
        )

        assert client.prompts_path == "/updated/path"
    finally:
        Client._reset_instance()
