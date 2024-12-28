import shutil
import subprocess
import sys
from pathlib import Path


def print_help():
    print("langwatch-server - Start the LangWatch development server")
    print("\nUsage:")
    print("  langwatch-server [--help|-h]")
    sys.exit(0)


def get_webapp_dir():
    return Path(__file__).parent.parent / "langwatch"


def npm_install():
    webapp_dir = get_webapp_dir()
    if not (webapp_dir / ".env").exists():
        shutil.copy(webapp_dir / ".env.example", webapp_dir / ".env")
    if not (webapp_dir / "node_modules").exists():
        print(
            "Setting up LangWatch for first time use, this is a one-time only operation..."
        )
        print("[1/2] 📦 Installing npm dependencies...")
        subprocess.run(["npm", "install"], cwd=webapp_dir, check=True)
        print("[2/2] 📦 Installing quickwit...")
        subprocess.run(["npm", "run", "setup:quickwit"], cwd=webapp_dir, check=True)


def start_dev_server():
    webapp_dir = get_webapp_dir()
    subprocess.run(["npm", "start"], cwd=webapp_dir)


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ["--help", "-h"]:
        print_help()

    try:
        npm_install()
        start_dev_server()
    except subprocess.CalledProcessError as e:
        print(f"Error: Failed to start server: {str(e)}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
        sys.exit(0)


if __name__ == "__main__":
    main()
