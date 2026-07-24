#!/usr/bin/env python3
"""
Simple test runner to check our guaranteed availability implementation.
Run this to see what errors we get and what needs to be implemented.
"""

import sys
import os
from pathlib import Path

# Add the src directory to the path
sys.path.insert(0, str(Path(__file__).parent / "src"))


def main():
    print("🧪 Testing Guaranteed Availability Implementation")
    print("=" * 50)

    try:
        print("1. Testing imports...")

        # Test langwatch import
        import langwatch

        print("   ✓ langwatch imported")

        # Test fixture imports
        try:
            # Add tests directory to path
            sys.path.insert(0, str(Path(__file__).parent / "tests"))
            from fixtures.prompt_fixtures import (
                cli_prompt_setup,
                empty_dir,
                clean_langwatch,
            )

            print("   ✓ prompt fixtures imported")
        except ImportError as e:
            print(f"   ✗ fixture import failed: {e}")
            print("   (This is expected - fixtures are for pytest, not direct import)")
            # Continue anyway

        # Test if we can access langwatch.prompts
        try:
            prompts = langwatch.prompts
            print(f"   ✓ langwatch.prompts accessible: {type(prompts)}")
        except Exception as e:
            print(f"   ✗ langwatch.prompts access failed: {e}")
            return

        print("\n2. Testing current behavior...")

        # Try to call get() with no setup (should fail gracefully)
        try:
            result = prompts.get("test-prompt")
            print(f"   ✓ prompts.get() succeeded (unexpected): {type(result)}")
        except Exception as e:
            print(f"   ✗ prompts.get() failed as expected: {e}")

        print("\n3. Testing with CLI-format files...")

        # Create a temporary directory with CLI files
        import tempfile
        import json

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Create CLI-format files
            config = {"prompts": {"my-prompt": "file:prompts/my-prompt.prompt.yaml"}}
            (temp_path / "prompts.json").write_text(json.dumps(config))

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

            # Change to temp directory
            original_cwd = Path.cwd()
            try:
                os.chdir(temp_path)

                # Clear cached prompts
                if "prompts" in langwatch.__dict__:
                    del langwatch.__dict__["prompts"]

                # Try to get the local prompt
                prompts = langwatch.prompts
                print(f"   Prompts service type: {type(prompts)}")

                try:
                    result = prompts.get("my-prompt")
                    if result:
                        print(f"   ✓ Local prompt loaded! Model: {result.model}")
                        print("   🎉 GUARANTEED AVAILABILITY WORKING!")
                    else:
                        print(
                            "   ✗ Local prompt not found (expected - not implemented yet)"
                        )
                except Exception as e:
                    print(f"   ✗ Local prompt loading failed: {e}")
                    import traceback

                    traceback.print_exc()

            finally:
                os.chdir(original_cwd)

        print("\n4. Summary:")
        print("   Current state: API-only PromptApiService")
        print("   Need to implement: LocalPromptsService + PromptsFacade")
        print("   Next step: Create local service that reads CLI files")

    except Exception as e:
        print(f"💥 Unexpected error: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    main()
