# tests/fixtures/prompts/cli.py
"""
CLI-specific fixtures for testing prompt functionality.

These fixtures create temporary directories with CLI-format files exactly as
the TypeScript CLI would generate them for guaranteed availability testing.
"""
import pytest
import tempfile
import json
from pathlib import Path


@pytest.fixture
def cli_prompt_setup():
    """
    Fixture that creates a temporary directory with CLI-format prompt files.
    Returns the temp directory path and handles cleanup.

    Creates the exact file structure that the TypeScript CLI generates:
    - prompts.json (configuration)
    - prompts-lock.json (materialized paths and versions)
    - prompts/my-prompt.prompt.yaml (actual prompt file)
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
