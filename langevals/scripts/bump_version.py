#!/usr/bin/env python3
"""
Version bumping script for uv-based projects.
Replaces `poetry version patch` functionality.

Usage:
    python bump_version.py [patch|minor|major]
    python bump_version.py  # defaults to patch
"""

import sys
import tomllib
import tomli_w
from pathlib import Path


def bump_version(pyproject_path: Path, part: str = "patch") -> str:
    """Bump the version in a pyproject.toml file."""
    with open(pyproject_path, "rb") as f:
        data = tomllib.load(f)

    version = data["project"]["version"]
    major, minor, patch = map(int, version.split("."))

    if part == "patch":
        patch += 1
    elif part == "minor":
        minor += 1
        patch = 0
    elif part == "major":
        major += 1
        minor = 0
        patch = 0
    else:
        raise ValueError(f"Unknown version part: {part}. Use 'major', 'minor', or 'patch'.")

    new_version = f"{major}.{minor}.{patch}"
    data["project"]["version"] = new_version

    with open(pyproject_path, "wb") as f:
        tomli_w.dump(data, f)

    print(f"Bumped {data['project']['name']} from {version} to {new_version}")
    return new_version


if __name__ == "__main__":
    part = sys.argv[1] if len(sys.argv) > 1 else "patch"
    pyproject = Path("pyproject.toml")

    if not pyproject.exists():
        print("Error: pyproject.toml not found in current directory")
        sys.exit(1)

    bump_version(pyproject, part)
