#!/usr/bin/env python3
"""Code-block sandbox runner.

Invoked by nlpgo for every code-block execution. Reads a JSON payload
from stdin describing the user's Python code, declared inputs, and
declared outputs; executes the code in a fresh module namespace;
writes a structured JSON result to the path passed as argv[1].

Four accepted user-code shapes (in this order of precedence):

  1. Legacy dspy.Module-style — what 387/388 production code-blocks
     use; kept as the highest-priority shape so existing customer code
     keeps working unchanged after the dspy-rip:

         class Code(dspy.Module):
             def forward(self, **inputs):
                 return {"output": ...}

  2. Class with __call__ — the new idiomatic Python default:

         class Code:
             def __call__(self, **inputs):
                 return {"output": ...}

     We require __call__ to be defined on the class itself
     (`'__call__' in cls.__dict__`) rather than inherited from `type`,
     otherwise every class would false-match (every class has an
     inherited __call__ for instantiation).

  3. Plain class + forward() — transitional shape, kept for back-compat
     with any customer who already wrote `class X: def forward(...)`
     during the dspy-rip transition window:

         class Code:
             def forward(self, **inputs):
                 return {"output": ...}

  4. Top-level execute() — kept for callers (chiefly our own tests +
     trivial sandboxes) that don't want a class:

         def execute(**inputs):
             return {"output": ...}

The user's `import dspy` resolves to the bundled fake_dspy stub (which
provides only Module + Prediction + Signature + InputField +
OutputField + Predict). The real dspy package is NOT in the
subprocess image — see fake_dspy.py for the one-customer-deep
rationale.

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

import inspect
import io
import json
import os
import sys
import time
import traceback
from contextlib import redirect_stdout, redirect_stderr

# Inject fake_dspy as the user-visible `dspy` module BEFORE any user
# code is exec'd. We resolve it by file path so the runner stays
# importable when invoked directly (sys.path = [cwd] only) without a
# package context. The runner ships next to fake_dspy.py.
_RUNNER_DIR = os.path.dirname(os.path.abspath(__file__))
if _RUNNER_DIR not in sys.path:
    sys.path.insert(0, _RUNNER_DIR)
import fake_dspy  # noqa: E402 — must come after sys.path manipulation
sys.modules.setdefault("dspy", fake_dspy)


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
            result = _invoke_user_entrypoint(module_globals, inputs)
            result = _coerce_result(result)
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


def _invoke_user_entrypoint(module_globals: dict, inputs: dict):
    """Find and call the user's entrypoint, supporting all four shapes.

    Resolution order:

      1. A class subclassing fake_dspy.Module (legacy dspy-style code).
      2. A class that defines __call__ on the class itself
         (the new idiomatic default — `instance(**inputs)` invokes it).
      3. A class with a `forward` method (transitional shape from the
         dspy-rip, kept for back-compat with customers who already
         migrated to plain `class X: def forward(...)`).
      4. A top-level `execute(**inputs) -> dict` callable.

    The first match wins. When multiple classes are present at the
    same priority level, the first one declared wins.

    We instantiate classes with no args because every customer code-block
    surveyed defines a no-arg constructor (387 use the implicit
    `dspy.Module.__init__`, 6 define their own `__init__(self)` with no
    args). Customer code that needs constructor args is unsupported by
    design — it didn't appear in production traffic.
    """
    dspy_module_cls = None
    callable_cls = None
    forward_cls = None
    for value in module_globals.values():
        if not inspect.isclass(value):
            continue
        if issubclass(value, fake_dspy.Module) and value is not fake_dspy.Module:
            if dspy_module_cls is None:
                dspy_module_cls = value
            continue
        # __call__ check: must be defined on the class itself, not
        # inherited from `type`. Every class has an inherited __call__
        # for instantiation; without this guard we'd false-match every
        # class the user defines.
        if "__call__" in value.__dict__ and callable(value.__dict__["__call__"]):
            if callable_cls is None:
                callable_cls = value
            continue
        if hasattr(value, "forward") and callable(getattr(value, "forward")):
            if forward_cls is None:
                forward_cls = value

    if dspy_module_cls is not None:
        # dspy.Module.__call__ routes to forward; calling the instance
        # is the path our fake_dspy.Module also follows.
        return dspy_module_cls()(**inputs)
    if callable_cls is not None:
        # Plain Python convention: instances of a class with __call__
        # are themselves callable. `Code()(**inputs)` first instantiates,
        # then __call__ runs.
        return callable_cls()(**inputs)
    if forward_cls is not None:
        return forward_cls().forward(**inputs)

    execute = module_globals.get("execute")
    if execute is not None and callable(execute):
        return execute(**inputs)

    raise NameError(
        "user code must define one of: a class with __call__(self, **inputs), "
        "a class with forward(self, **inputs), a dspy.Module subclass, or a "
        "top-level callable `execute(**inputs) -> dict`"
    )


def _coerce_result(result):
    """Normalize the user-code return value to a plain dict.

    Customer code returns either a dict (most common — survey shows
    386/388) or a `dspy.Prediction(...)` (6 cases — kwargs become
    attributes that we surface as dict keys). None is treated as an
    empty dict so a `forward()` that omits its return doesn't crash
    the runner with a confusing TypeError.
    """
    if result is None:
        return {}
    if isinstance(result, dict):
        return result
    if isinstance(result, fake_dspy.Prediction):
        return dict(result.__dict__)
    raise TypeError(
        f"user-code entrypoint must return dict, dspy.Prediction, or None — got {type(result).__name__}"
    )


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
