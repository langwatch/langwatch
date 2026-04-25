#!/usr/bin/env python3
"""Code-block sandbox runner.

Invoked by nlpgo for every code-block execution. Reads a JSON payload
from stdin describing the user's Python code, declared inputs, and
declared outputs; executes the code in a fresh module namespace;
writes a structured JSON result to the path passed as argv[1].

Wire shape (stdin):
    {
      "code":    "<python source>",
      "inputs":  {"name": value, ...},
      "outputs": ["name", ...]
    }

Wire shape (result file):
    {
      "outputs":    {"name": value, ...},
      "stdout":     "<captured stdout>",
      "stderr":     "<captured stderr>",
      "duration_ms": <int>,
      "error":      null | {
          "type":      "<ExceptionClassName>",
          "message":   "<str(e)>",
          "traceback": "<formatted traceback>"
      }
    }
"""

from __future__ import annotations

import io
import json
import sys
import time
import traceback
from contextlib import redirect_stdout, redirect_stderr


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: runner.py <result_path>\n")
        return 2
    result_path = sys.argv[1]
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        write_result(result_path, error={
            "type": "ProtocolError",
            "message": f"invalid JSON on stdin: {e}",
            "traceback": "",
        })
        return 1

    code = payload.get("code", "")
    inputs = payload.get("inputs", {}) or {}
    declared_outputs = payload.get("outputs", []) or []

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    started = time.perf_counter()
    error = None
    outputs: dict = {}

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            module_globals: dict = {"__name__": "__user_code__"}
            exec(compile(code, "<code-block>", "exec"), module_globals)
            execute = module_globals.get("execute")
            if execute is None or not callable(execute):
                raise NameError("user code must define a callable `execute(**inputs) -> dict`")
            result = execute(**inputs)
            if result is None:
                result = {}
            if not isinstance(result, dict):
                raise TypeError(
                    f"execute() must return a dict, got {type(result).__name__}"
                )
            for name in declared_outputs:
                if name not in result:
                    raise KeyError(f"missing_output: {name}")
                outputs[name] = result[name]
    except Exception as exc:  # noqa: BLE001 — sandbox runner intentionally catches every user-code exception so Go can render a structured error in Studio
        error = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    write_result(
        result_path,
        outputs=outputs,
        stdout=stdout_buf.getvalue(),
        stderr=stderr_buf.getvalue(),
        duration_ms=elapsed_ms,
        error=error,
    )
    return 0 if error is None else 1


def write_result(path, **fields):
    payload = {
        "outputs": fields.get("outputs", {}),
        "stdout": fields.get("stdout", ""),
        "stderr": fields.get("stderr", ""),
        "duration_ms": fields.get("duration_ms", 0),
        "error": fields.get("error"),
    }
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, default=_safe_default)
    except Exception:
        # Last-ditch: dump to stderr so nlpgo at least gets *something*.
        sys.stderr.write(json.dumps(payload, default=_safe_default))


def _safe_default(value):
    """Make non-JSON-serializable values stringifiable rather than crashing."""
    try:
        return str(value)
    except Exception:
        return repr(value)


if __name__ == "__main__":
    sys.exit(main())
