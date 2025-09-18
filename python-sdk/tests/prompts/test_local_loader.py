"""
Tests for LocalPromptLoader functionality.
"""

import json
import tempfile
import warnings
from pathlib import Path

import pytest

from langwatch.prompts.local_loader import LocalPromptLoader


def test_load_prompt_from_local_files():
    """
    GIVEN local prompt files exist in CLI format
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return a properly formatted API response
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # Create prompts-lock.json
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

        # Create the prompt file
        prompts_dir = temp_path / "prompts"
        prompts_dir.mkdir()

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

        # Test the loader
        loader = LocalPromptLoader(temp_path)
        result = loader.load_prompt("my-prompt")

    # Verify the result
    assert result is not None
    assert result["handle"] == "my-prompt"  # Local files use handle, not id
    assert result["model"] == "openai/gpt-4"
    assert len(result["messages"]) == 2
    assert result["messages"][0]["role"] == "system"
    assert result["messages"][0]["content"] == "You are a helpful assistant."
    assert result["messages"][1]["role"] == "user"
    assert result["messages"][1]["content"] == "{{input}}"


def test_load_prompt_returns_none_when_no_prompts_json():
    """
    GIVEN no prompts.json file exists
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        loader = LocalPromptLoader(Path(temp_dir))
        result = loader.load_prompt("nonexistent-prompt")
        assert result is None


def test_load_prompt_returns_none_when_prompt_not_in_config():
    """
    GIVEN prompts.json exists but doesn't contain the requested prompt
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json without the requested prompt
        config = {"prompts": {"other-prompt": "file:prompts/other-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        loader = LocalPromptLoader(temp_path)
        result = loader.load_prompt("my-prompt")
        assert result is None


def test_load_prompt_returns_none_when_no_lock_file():
    """
    GIVEN prompts.json exists but no prompts-lock.json
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        loader = LocalPromptLoader(temp_path)
        result = loader.load_prompt("my-prompt")
        assert result is None


def test_load_prompt_returns_none_when_prompt_file_missing():
    """
    GIVEN prompts.json and prompts-lock.json exist but actual prompt file is missing
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # Create prompts-lock.json
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

        # Don't create the actual prompt file

        loader = LocalPromptLoader(temp_path)
        result = loader.load_prompt("my-prompt")
        assert result is None


def test_load_prompt_handles_yaml_parsing_errors():
    """
    GIVEN local files exist but prompt YAML is malformed
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None (graceful fallback) and issue a warning
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # Create prompts-lock.json
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

        # Create malformed YAML file
        prompts_dir = temp_path / "prompts"
        prompts_dir.mkdir()
        (prompts_dir / "my-prompt.prompt.yaml").write_text("invalid: yaml: content: [")

        loader = LocalPromptLoader(temp_path)

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = loader.load_prompt("my-prompt")

            assert result is None
            assert len(w) == 1
            assert "Failed to parse prompt file" in str(w[0].message)
            assert "my-prompt" in str(w[0].message)


def test_load_prompt_warns_when_lock_file_missing():
    """
    GIVEN prompts.json exists but prompts-lock.json is missing
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None and warn the user to run 'langwatch prompts pull'
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # Don't create prompts-lock.json

        loader = LocalPromptLoader(temp_path)

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = loader.load_prompt("my-prompt")

            assert result is None
            assert len(w) == 1
            assert "prompts-lock.json not found" in str(w[0].message)
            assert "langwatch prompts pull" in str(w[0].message)


def test_load_prompt_warns_when_prompt_file_missing():
    """
    GIVEN prompts.json and prompts-lock.json exist but actual prompt file is missing
    WHEN LocalPromptLoader.load_prompt() is called
    THEN it should return None and warn the user to run 'langwatch prompts pull'
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create prompts.json
        config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
        (temp_path / "prompts.json").write_text(json.dumps(config))

        # Create prompts-lock.json
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

        # Don't create the actual prompt file

        loader = LocalPromptLoader(temp_path)

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = loader.load_prompt("my-prompt")

            assert result is None
            assert len(w) == 1
            assert "Prompt file not found" in str(w[0].message)
            assert "langwatch prompts pull" in str(w[0].message)
