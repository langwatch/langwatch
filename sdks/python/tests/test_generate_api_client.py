"""`make generate/api-client` keeps the committed client when generation fails.

Spec: specs/python-sdk/generate-api-client.feature (langwatch/tasks#509)

The target used to delete the committed client before the generator ran, so
a generator that could not run left the SDK without its client. Each test
copies the real Makefile into a throwaway tree shaped like the repo, puts
stub `pnpm` and `uv` executables first on PATH, and runs the target with
make. The stubs stand in for the OpenAPI export and the generator, so no
network or real generator is involved.

These run in the default (unmarked) lane on purpose: `make test-unit`, which
CI runs, deselects tests marked `integration`.
"""

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SDK_DIR = Path(__file__).resolve().parents[1]
CLIENT_DIR = Path("src/langwatch/generated/langwatch_rest_api_client")
COMMITTED = "COMMITTED = True\n"
GENERATED = "GENERATED = True\n"

pytestmark = pytest.mark.skipif(
    shutil.which("make") is None, reason="needs make to run the Makefile target"
)

# `uv pip install ...` succeeds. `uv run openapi-python-client generate ...
# --output-path DIR` does what STUB_GENERATOR says: fail, exit 0 without
# writing a client, or write a new client package into DIR.
STUB_UV = """#!/bin/sh
[ "$1" = "pip" ] && exit 0
out=""
while [ $# -gt 0 ]; do
  [ "$1" = "--output-path" ] && out="$2"
  shift
done
case "$STUB_GENERATOR" in
  fail) echo "stub generator: cannot run" >&2; exit 1 ;;
  empty) exit 0 ;;
  ok) mkdir -p "$out/lang_watch_api_client" && printf 'GENERATED = True\\n' > "$out/lang_watch_api_client/__init__.py" ;;
esac
"""


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _repo_shaped_tree(root: Path) -> Path:
    """A copy of what the target touches, with a committed client in place."""
    spec = root / "platform/app/src/app/api/openapiLangWatch.json"
    spec.parent.mkdir(parents=True)
    spec.write_text(
        json.dumps(
            {
                "openapi": "3.1.0",
                "info": {"title": "stub", "version": "0"},
                "paths": {},
                "components": {"schemas": {"JsonValue": {}}},
            }
        )
    )
    sdk = root / "sdks/python"
    (sdk / "scripts").mkdir(parents=True)
    shutil.copy(SDK_DIR / "Makefile", sdk / "Makefile")
    shutil.copy(
        SDK_DIR / "scripts/spec-for-python-generator.py",
        sdk / "scripts/spec-for-python-generator.py",
    )
    client = sdk / CLIENT_DIR
    client.mkdir(parents=True)
    (client / "__init__.py").write_text(COMMITTED)
    return sdk


def _run_target(
    tmp_path: Path, generator: str
) -> tuple[subprocess.CompletedProcess, Path]:
    sdk = _repo_shaped_tree(tmp_path / "repo")
    stubs = tmp_path / "stubs"
    stubs.mkdir()
    _write_executable(stubs / "pnpm", "#!/bin/sh\nexit 0\n")
    _write_executable(stubs / "uv", STUB_UV)
    env = {
        key: value
        for key, value in os.environ.items()
        # A parent `make test-unit` exports these; they must not steer the child.
        if key not in {"MAKEFLAGS", "MFLAGS", "MAKELEVEL", "MAKEOVERRIDES"}
    }
    env["PATH"] = f"{stubs}{os.pathsep}{env.get('PATH', '')}"
    env["STUB_GENERATOR"] = generator
    result = subprocess.run(
        ["make", "generate/api-client"],
        cwd=sdk,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return result, sdk / CLIENT_DIR


# @scenario "A generator that fails leaves the committed client in place"
def test_a_failing_generator_keeps_the_committed_client(tmp_path: Path):
    result, client = _run_target(tmp_path, "fail")

    assert result.returncode != 0
    assert (client / "__init__.py").read_text() == COMMITTED


# @scenario "A generator that writes no client leaves the committed client in place"
def test_a_generator_that_writes_no_client_keeps_the_committed_client(tmp_path: Path):
    result, client = _run_target(tmp_path, "empty")

    assert result.returncode != 0
    assert "keeping the committed one" in result.stdout + result.stderr
    assert (client / "__init__.py").read_text() == COMMITTED


# @scenario "A generated client replaces the committed one"
def test_a_generated_client_replaces_the_committed_one(tmp_path: Path):
    result, client = _run_target(tmp_path, "ok")

    assert result.returncode == 0, result.stdout + result.stderr
    assert (client / "__init__.py").read_text() == GENERATED
