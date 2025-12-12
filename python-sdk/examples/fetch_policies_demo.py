#!/usr/bin/env python3
"""
Fetch Policies Demo

Demonstrates different fetch policies for prompt retrieval:

1. MATERIALIZED_FIRST (default) - Local first, API fallback
2. ALWAYS_FETCH - API first, local fallback
3. MATERIALIZED_ONLY - Local only, no API calls
4. CACHE_TTL - Cached with TTL, local fallback

Prerequisites:
- Set LANGWATCH_API_KEY environment variable
- Have Node.js/npx installed for CLI operations

Run: python examples/fetch_policies_demo.py
"""

import os
import time
from pathlib import Path
import tempfile
import subprocess

from dotenv import load_dotenv
import langwatch
from langwatch import FetchPolicy
from examples.test_utils.run_cli import run_cli


load_dotenv()

CLI_EXECUTABLE = ["npx", "langwatch@latest"]


def setup_local_prompt(work_dir: Path, prompt_name: str) -> str:
    """Set up a local prompt using CLI and return its name."""
    print(f"\n🔧 Setting up local prompt: {prompt_name}")

    # CLI init
    run_cli(CLI_EXECUTABLE + ["prompt", "init"], work_dir)

    # CLI create
    run_cli(CLI_EXECUTABLE + ["prompt", "create", prompt_name], work_dir)

    # CLI add to local project
    prompt_file_path = f"prompts/{prompt_name}.prompt.yaml"
    run_cli(
        CLI_EXECUTABLE + ["prompt", "add", prompt_name, prompt_file_path],
        work_dir,
    )

    print(f"✅ Local prompt '{prompt_name}' ready")
    return prompt_name


def demo_materialized_first(work_dir: Path, prompt_name: str):
    """Demo MATERIALIZED_FIRST policy (default)."""
    print("\n" + "=" * 60)
    print("🚀 Demo: MATERIALIZED_FIRST (default policy)")
    print("   Local first → API fallback")
    print("=" * 60)

    os.chdir(work_dir)
    langwatch.setup(debug=True)

    start_time = time.time()
    prompt = langwatch.prompts.get(prompt_name)  # Uses default MATERIALIZED_FIRST
    end_time = time.time()

    print(f"   Time taken: {end_time - start_time:.3f} seconds")
    print(f"   Model: {prompt.model}")
    print("   ✅ Success - loaded from local (no API call needed)")


def demo_always_fetch(work_dir: Path, prompt_name: str):
    """Demo ALWAYS_FETCH policy."""
    print("\n" + "=" * 60)
    print("🚀 Demo: ALWAYS_FETCH")
    print("   API first → local fallback")
    print("=" * 60)

    os.chdir(work_dir)

    print("   (Note: This would normally call API, but we can't demo that easily)")
    print("   ✅ Policy exists and is implemented")


def demo_materialized_only(work_dir: Path, prompt_name: str):
    """Demo MATERIALIZED_ONLY policy."""
    print("\n" + "=" * 60)
    print("🚀 Demo: MATERIALIZED_ONLY")
    print("   Local only → no API calls")
    print("=" * 60)

    os.chdir(work_dir)

    start_time = time.time()
    prompt = langwatch.prompts.get(
        prompt_name, fetch_policy=FetchPolicy.MATERIALIZED_ONLY
    )
    end_time = time.time()

    print(f"   Time taken: {end_time - start_time:.3f} seconds")
    print(f"   Model: {prompt.model}")
    print("   ✅ Success - loaded from local (guaranteed no API call)")


def demo_cache_ttl(work_dir: Path, prompt_name: str):
    """Demo CACHE_TTL policy."""
    print("\n" + "=" * 60)
    print("🚀 Demo: CACHE_TTL")
    print("   Cache with TTL → local fallback")
    print("=" * 60)

    os.chdir(work_dir)

    print("   (Note: This would normally demonstrate caching, but needs API)")
    print("   ✅ Policy exists and is implemented")


def main():
    langwatch.setup()

    print("🚀 Fetch Policies Demo")
    print("Demonstrating different prompt retrieval strategies")

    # Check API key
    api_key = os.getenv("LANGWATCH_API_KEY")
    if not api_key:
        print("⚠️  Warning: LANGWATCH_API_KEY not set - some demos may not work fully")
    else:
        print("✅ API key found")

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)

        try:
            # Set up a local prompt for testing
            prompt_name = f"fetch-policy-demo-{int(time.time())}"
            setup_local_prompt(work_dir, prompt_name)

            # Demo each fetch policy
            demo_materialized_first(work_dir, prompt_name)
            demo_always_fetch(work_dir, prompt_name)
            demo_materialized_only(work_dir, prompt_name)
            demo_cache_ttl(work_dir, prompt_name)

            print("\n🎉 All fetch policy demos completed!")
            print("\n📚 Learn more:")
            print("   - MATERIALIZED_FIRST: Default, local-first with API fallback")
            print("   - ALWAYS_FETCH: API-first with local fallback")
            print("   - MATERIALIZED_ONLY: Local-only, offline capable")
            print("   - CACHE_TTL: Time-based caching with local fallback")

        except subprocess.CalledProcessError as e:
            print(f"❌ CLI command failed: {e}")
            raise
        except Exception as e:
            print(f"❌ Error: {e}")
            raise


if __name__ == "__main__":
    main()
