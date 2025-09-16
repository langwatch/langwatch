#!/usr/bin/env python3
"""
Simple Local Prompts Example

Shows guaranteed availability by:
1. CLI init - Initialize prompts project
2. CLI create - Create a prompt
3. CLI add - Add prompt to local project
4. Python SDK - Load prompt locally

Prerequisites:
- Set LANGWATCH_API_KEY environment variable
- Have Node.js/npx installed

Run: python examples/guaranteed_availability_with_cli.py
"""

import os
import subprocess
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv
import langwatch

load_dotenv()

CLI_EXECUTABLE = ["npx", "langwatch@latest"]


def run_cli(command: list, cwd: Path):
    """Run CLI command and handle errors."""
    print(f"▶️  {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            input="Y\n",  # Answer "Y" to prompts
        )
        if result.returncode != 0:
            print(f"❌ Failed: {result.stderr}")
            raise subprocess.CalledProcessError(result.returncode, command)
        return result
    except subprocess.TimeoutExpired:
        print("❌ Command timed out after 30 seconds")
        raise


@langwatch.trace()
def main():
    """Simple guaranteed availability demo."""
    print("🚀 Simple Local Prompts Example")

    # Check API key
    if not os.getenv("LANGWATCH_API_KEY"):
        print("❌ Set LANGWATCH_API_KEY environment variable")
        return

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)
        os.chdir(work_dir)

        try:
            # 1. CLI init
            print("\n1️⃣ Initialize prompts project")
            run_cli(CLI_EXECUTABLE + ["prompt", "init"], work_dir)
            print("✅ Project initialized")

            # 2. CLI create
            print("\n2️⃣ Create prompt")
            prompt_name = f"simple-example-{int(time.time())}"
            run_cli(CLI_EXECUTABLE + ["prompt", "create", prompt_name], work_dir)
            print(f"✅ Created prompt: {prompt_name}")

            # Show what was created
            print(f"📁 Files in {work_dir}:")
            for item in work_dir.iterdir():
                print(f"   - {item.name}")
                if item.is_dir():
                    for subitem in item.iterdir():
                        print(f"     - {subitem.name}")

            # 3. CLI add - register the prompt in local project
            print("\n3️⃣ Add prompt to local project")
            prompt_file_path = f"prompts/{prompt_name}.prompt.yaml"
            run_cli(
                CLI_EXECUTABLE + ["prompt", "add", prompt_name, prompt_file_path],
                work_dir,
            )
            print("✅ Added to local project")

            # Show what was created after add
            print(f"📁 Files after add:")
            for item in work_dir.iterdir():
                print(f"   - {item.name}")
                if item.is_dir():
                    for subitem in item.iterdir():
                        print(f"     - {subitem.name}")

            # 4. Python SDK - load locally
            print("\n4️⃣ Load prompt with Python SDK")
            langwatch.setup(debug=True)
            prompt = langwatch.prompts.get(prompt_name)
            print("✅ Loaded prompt from local files!")
            print(f"   ID: {prompt.id}")
            print(f"   Model: {prompt.model}")

            print("\n🎉 Done! Guaranteed availability achieved.")

        except subprocess.CalledProcessError as e:
            print(f"❌ CLI command failed: {e}")
        except Exception as e:
            print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()
