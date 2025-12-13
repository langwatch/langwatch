import subprocess
from pathlib import Path


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
