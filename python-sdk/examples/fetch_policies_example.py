#!/usr/bin/env python3
"""
Fetch Policies Example

This example demonstrates how to use different fetch policies when retrieving prompts
from LangWatch. Fetch policies control how prompts are retrieved and cached.

Prerequisites:
- LANGWATCH_API_KEY environment variable
- Node.js/npx installed for CLI operations (optional, for local prompts)

Run: python examples/fetch_policies_example.py
"""

import os
import time
from pathlib import Path
import tempfile
import contextlib
from dotenv import load_dotenv

import langwatch
from langwatch import FetchPolicy

load_dotenv()


@contextlib.contextmanager
def working_directory(path):
    """Temporarily change the working directory."""
    original_cwd = Path.cwd()
    try:
        os.chdir(path)
        yield
    finally:
        os.chdir(original_cwd)


def setup_example_prompts():
    """Set up example prompts for demonstration."""
    print("🚀 Setting up example prompts...")

    # Create prompts on the server
    base_time = int(time.time())

    # Create different prompts for different scenarios
    prompts = {
        f"cached-prompt-{base_time}": {
            "prompt": "You are a helpful assistant that provides concise answers.",
            "model": "openai/gpt-4",
        },
        f"local-only-prompt-{base_time}": {
            "prompt": "You are a specialized assistant for technical questions.",
            "model": "openai/gpt-3.5-turbo",
        },
    }

    created_prompts = {}
    for handle, config in prompts.items():
        try:
            prompt = langwatch.prompts.create(
                handle=handle,
                prompt=config["prompt"],
                messages=[{"role": "system", "content": config["prompt"]}],
                model=config["model"],
            )
            created_prompts[handle] = prompt
            print(f"✅ Created prompt: {handle}")
        except Exception as e:
            print(f"⚠️  Failed to create {handle}: {e}")

    return created_prompts


def demonstrate_materialized_first(prompt_handle: str):
    """Demonstrate MATERIALIZED_FIRST policy - default behavior."""
    print("\n" + "=" * 60)
    print("📥 MATERIALIZED_FIRST (Default Policy)")
    print("   Strategy: Local first → API fallback")
    print("   Use when: You want fast local access with server backup")
    print("=" * 60)

    try:
        start_time = time.time()
        prompt = langwatch.prompts.get(prompt_handle)  # Uses default MATERIALIZED_FIRST
        end_time = time.time()

        print(".3f")
        print(f"   Model: {prompt.model}")
        print(f"   Content: {prompt.prompt[:80]}...")
        print("   ✅ Success - retrieved prompt")

    except Exception as e:
        print(f"   ❌ Failed: {e}")


def demonstrate_always_fetch(prompt_handle: str):
    """Demonstrate ALWAYS_FETCH policy - always contact API first."""
    print("\n" + "=" * 60)
    print("🌐 ALWAYS_FETCH Policy")
    print("   Strategy: API first → local fallback")
    print("   Use when: You need the latest version from server")
    print("=" * 60)

    try:
        start_time = time.time()
        prompt = langwatch.prompts.get(
            prompt_handle, fetch_policy=FetchPolicy.ALWAYS_FETCH
        )
        end_time = time.time()

        print(".3f")
        print(f"   Model: {prompt.model}")
        print(f"   Content: {prompt.prompt[:80]}...")
        print("   ✅ Success - fetched from API")

    except Exception as e:
        print(f"   ❌ Failed: {e}")


def demonstrate_cache_ttl(prompt_handle: str):
    """Demonstrate CACHE_TTL policy - time-based caching."""
    print("\n" + "=" * 60)
    print("⏰ CACHE_TTL Policy")
    print("   Strategy: Cache for X minutes, then refresh")
    print("   Use when: You want periodic updates but cache performance")
    print("=" * 60)

    try:
        # First call - should cache
        print("   First call (will cache for 30 seconds):")
        start_time = time.time()
        prompt1 = langwatch.prompts.get(
            prompt_handle,
            fetch_policy=FetchPolicy.CACHE_TTL,
            cache_ttl_minutes=0.5,  # 30 seconds for demo
        )
        end_time = time.time()

        print(".3f")
        print(f"   Cached until: {time.ctime(time.time() + 30)}")

        # Second call - should use cache
        print("   Second call (should use cache):")
        start_time = time.time()
        prompt2 = langwatch.prompts.get(
            prompt_handle, fetch_policy=FetchPolicy.CACHE_TTL, cache_ttl_minutes=0.5
        )
        end_time = time.time()

        print(".3f")
        print("   ✅ Success - used cached version")

    except Exception as e:
        print(f"   ❌ Failed: {e}")


def demonstrate_materialized_only_with_local_setup(prompt_handle: str):
    """Demonstrate MATERIALIZED_ONLY policy with local prompt setup."""
    print("\n" + "=" * 60)
    print("💾 MATERIALIZED_ONLY Policy")
    print("   Strategy: Local files only, no API calls")
    print("   Use when: You want offline capability or guaranteed no network calls")
    print("=" * 60)

    # Create a temporary directory for local setup
    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)

        print(f"   Setting up local prompt in: {work_dir}")

        with working_directory(work_dir):
            try:
                # This would normally use CLI to set up local prompts
                # For demo purposes, we'll show the concept
                print("   Note: This policy requires local prompt files")
                print("   In practice, use LangWatch CLI to create local prompts")
                print("   Then use MATERIALIZED_ONLY for offline access")

                # Try to get prompt (will likely fail without local setup)
                prompt = langwatch.prompts.get(
                    prompt_handle, fetch_policy=FetchPolicy.MATERIALIZED_ONLY
                )

                print(f"   Model: {prompt.model}")
                print("   ✅ Success - loaded from local file only")

            except Exception as e:
                print(f"   ❌ Failed (expected without local setup): {e}")
                print("   💡 Tip: Use 'langwatch prompt sync' to create local files")


def cleanup_prompts(prompts):
    """Clean up created prompts."""
    print("\n🧹 Cleaning up prompts...")
    for handle, prompt in prompts.items():
        try:
            langwatch.prompts.delete(prompt.id)
            print(f"✅ Deleted: {handle}")
        except Exception as e:
            print(f"⚠️  Failed to delete {handle}: {e}")


def main():
    """Main demonstration function."""
    print("🔧 LangWatch Fetch Policies Example")
    print("Demonstrating different strategies for prompt retrieval\n")

    # Check API key
    api_key = os.getenv("LANGWATCH_API_KEY")
    if not api_key:
        print("❌ LANGWATCH_API_KEY environment variable not set")
        print("Please set it and run again:")
        print("export LANGWATCH_API_KEY='your-api-key'")
        return

    # Initialize LangWatch
    langwatch.setup(api_key=api_key)
    print("✅ LangWatch initialized")

    try:
        # Set up example prompts
        prompts = setup_example_prompts()

        if not prompts:
            print("❌ No prompts were created successfully")
            return

        # Get the first prompt handle for demonstrations
        prompt_handle = list(prompts.keys())[0]

        # Demonstrate different fetch policies
        demonstrate_materialized_first(prompt_handle)
        demonstrate_always_fetch(prompt_handle)
        demonstrate_cache_ttl(prompt_handle)
        demonstrate_materialized_only_with_local_setup(prompt_handle)

        print("\n" + "=" * 60)
        print("📚 Fetch Policies Summary")
        print("=" * 60)
        print("• MATERIALIZED_FIRST: Fast local access, API fallback")
        print("• ALWAYS_FETCH: Always get latest from server")
        print("• CACHE_TTL: Balance freshness with performance")
        print("• MATERIALIZED_ONLY: Offline-first, no network calls")
        print("\n💡 Choose the policy that fits your reliability vs performance needs!")

    finally:
        # Clean up
        if "prompts" in locals():
            cleanup_prompts(prompts)


if __name__ == "__main__":
    main()
