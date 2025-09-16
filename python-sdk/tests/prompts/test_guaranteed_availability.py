import os
from pathlib import Path
from unittest.mock import patch, Mock
import httpx

import langwatch


def test_prompts_get_checks_local_files_first(cli_prompt_setup: Path, clean_langwatch):
    """
    GIVEN a local prompt file exists (created in CLI format)
    WHEN I call langwatch.prompts.get()
    THEN it should return the local prompt without calling the API

    NOTE: This test blocks all HTTP requests to ensure local file loading
    is used when implemented. Currently will fail until local loading is added.
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(cli_prompt_setup)

        # Block all HTTP requests by making them fail
        with patch("httpx.Client.request") as mock_request:
            mock_request.side_effect = httpx.ConnectError("Connection blocked for test")

            result = langwatch.prompts.get("my-prompt")

            # If we get here, local file loading worked
            assert result is not None
            assert result.model == "openai/gpt-4"
            # Verify no HTTP calls were made
            mock_request.assert_not_called()

    finally:
        os.chdir(original_cwd)


def test_prompts_get_falls_back_to_api_when_no_local_file(
    empty_dir: Path, clean_langwatch
):
    """
    GIVEN no local prompt file exists
    WHEN I call langwatch.prompts.get()
    THEN it should fallback to the API service
    """
    original_cwd = Path.cwd()
    try:
        os.chdir(empty_dir)

        # Mock the API response at HTTP level
        mock_response = Mock()
        mock_response.status_code = 200
        # Use a minimal valid response that matches the API schema
        mock_response.json.return_value = {
            "id": "api-prompt",
            "handle": "api-prompt",
            "scope": "PROJECT",
            "name": "Test Prompt",
            "updatedAt": "2023-01-01T00:00:00Z",
            "projectId": "project_1",
            "organizationId": "org_1",
            "versionId": "version_123",
            "version": 1,
            "createdAt": "2023-01-01T00:00:00Z",
            "prompt": "Hello {{ name }}!",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "{{input}}"},
            ],
            "inputs": [],
            "outputs": [],
            "model": "openai/gpt-4",
        }

        with patch("httpx.Client.request") as mock_request:
            mock_request.return_value = mock_response

            result = langwatch.prompts.get("api-prompt")

            # Verify: Got the API prompt
            assert result is not None
            assert result.model == "openai/gpt-4"

            # Verify HTTP call was made
            mock_request.assert_called_once()
            # Check that the request was for the right prompt
            call_args = mock_request.call_args
            assert "api-prompt" in str(call_args)

    finally:
        os.chdir(original_cwd)
