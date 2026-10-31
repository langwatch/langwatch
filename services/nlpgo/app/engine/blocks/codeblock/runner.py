#!/usr/bin/env python3
"""Code-block sandbox runner.

Invoked by nlpgo for every code-block execution. Asks nlpgo for a JSON
payload describing the user's Python code, declared inputs, declared
outputs and working directory; executes the code in a fresh module
namespace; writes a structured JSON result to the path the payload
names.

Nothing belonging to the run arrives on the command line, in the
variables exec hands this process, or on a descriptor it is handed: all
three are readable from /proc by anything running as the same user,
which every other code block in the container is. This process makes
itself non-dumpable and then asks for the payload, which is why there
is no moment where it holds something and can still be read.

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
rationale. The stub arrives as source in the payload and is built as a
module in memory: neither it nor this runner is ever written to the
filesystem, so the executed code has no copy of either to rewrite.

Wire shape (the payload, asked for over the socket nlpgo names in
NLPGO_CODE_BLOCK_CHANNEL, or read from stdin where there is none):
    {
      "code":        "<python source>",
      "inputs":      {"name": value, ...},
      "outputs":     ["name", ...],
      "secrets":     {"NAME": "value", ...},
      "params":      {"NAME": value, ...},
      "dspy_stub":   "<python source of the dspy stand-in>",
      "result_path": "<where to write the result>",
      "work_dir":    "<the run's directory, which this process moves into>",
      "nonce":       "<stamped on the result so nlpgo knows it is ours>",
      "env":         {"NAME": "value", ...}
    }

The optional `secrets` map is the project's decrypted secrets (rides on
the workflow DSL as `workflow.secrets`, populated upstream by
addEnvs.ts). When non-empty it is exposed to user code as a `secrets`
namespace object so `secrets.NAME` resolves as attribute access —
matching the Studio code-editor hint and the Python executor's
`build_secrets_preamble`. When absent/empty the name is left undefined,
mirroring the Python preamble's no-op-on-empty behavior.

The optional `params` map is the run's user-defined parameters (rides on
the workflow DSL as `workflow.params`) and is exposed the same way, as a
`params` namespace so `params.NAME` resolves as attribute access. Unlike
secrets, its values keep their JSON types, so a number configured as a
number arrives as an int/float and a boolean arrives as a bool.

Wire shape (result file):
    {
      "outputs":    {"name": value, ...},
      "stdout":     "<captured stdout>",
      "stderr":     "<captured stderr>",
      "duration_ms": <int>,
      "nonce":      "<the nonce from the payload>",
      "error":      null | {
          "type":      "<ExceptionClassName>",
          "message":   "<str(e)>",
          "traceback": "<formatted traceback>"
      }
    }
"""

from __future__ import annotations

import os
import sys

# FIRST, before the payload is asked for: take this process's own /proc
# files away from everything running as the same user. Every code block
# in the container runs as that user, so without this one execution
# reads another's open descriptors, its initial variables and the path
# of its working directory. State and the command line stay readable,
# which is what the engine's teardown uses.
#
# nlpgo hands this process nothing of the run, so there is nothing to
# read until this has happened: the payload is asked for below, over a
# socket the engine answers by the kernel's own idea of who is asking.
#
# On Linux this has to work, which is why nothing here is caught: a
# failure is the one state in which the payload would arrive into a
# process another execution can read, so the run fails instead. There
# is nothing to hide anywhere else: no /proc, and no prctl.
_PR_SET_DUMPABLE = 4


def _hide_from_other_executions() -> None:
    if not sys.platform.startswith("linux"):
        return

    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "prctl(PR_SET_DUMPABLE) failed")


_hide_from_other_executions()

import inspect  # noqa: E402 — everything above runs before the payload exists
import io
import json
import re
import time
import traceback
from contextlib import redirect_stdout, redirect_stderr
from types import ModuleType, SimpleNamespace

# nlpgo passes this runner as source on the command line, so the
# interpreter puts the working directory first on sys.path. Drop it (and
# any relative entry that resolves to it) before anything is imported,
# so no import can be answered by a file the executed code planted: the
# run's directory, which this process moves into once it has its
# payload, is the one place user code can write. PYTHONPATH keeps its
# place: it is how the runtime images reach the curated sandbox
# libraries.
_WORK_DIR = os.getcwd()
sys.path[:] = [
    entry for entry in sys.path
    if entry not in ("", ".", _WORK_DIR) and os.path.abspath(entry) != _WORK_DIR
]

# The `dspy` stand-in arrives in the payload as source, not as a file
# next to the runner, for the same reason the runner itself does. It is
# built as a module in memory and registered before any user code runs.
fake_dspy = None


def install_dspy_stub(source):
    """Build the bundled dspy stand-in from source and register it."""
    global fake_dspy
    module = ModuleType("fake_dspy")
    exec(compile(source, "<fake_dspy>", "exec"), module.__dict__)
    fake_dspy = module
    sys.modules["fake_dspy"] = module
    sys.modules.setdefault("dspy", module)


# The runner is compiled from source nlpgo passes on the command line, so its
# frames carry the interpreter's placeholder filename rather than a path. They
# are dropped from what the customer is shown: they say nothing about why the
# customer's code failed, and the frame that named a path used to point at the
# directory the runner ran from.
_RUNNER_FILENAME = (lambda: None).__code__.co_filename
_RUNNER_FRAME = re.compile(
    r'^  File "%s", line \d+.*\n(?:    .*\n)?' % re.escape(_RUNNER_FILENAME),
    re.MULTILINE,
)
_USER_CODE_FILENAME = "<code-block>"


def format_user_traceback() -> str:
    """Format the current exception, without the runner's own frames.

    Formatted as text and filtered, rather than rebuilt from the frame list,
    so a chained exception keeps its "During handling of the above" section.
    A failure the runner raised itself, such as a declared output the code
    never set, has no frame left once its own are gone, and reports as the
    exception alone rather than as a walk through the runner.
    """
    text = _RUNNER_FRAME.sub("", traceback.format_exc())
    if '  File "' in text:
        return text
    return "".join(traceback.format_exception_only(*sys.exc_info()[:2]))


_PAYLOAD_TIMEOUT_S = 30


def read_payload() -> str:
    """Ask nlpgo for this run's payload, now that this process is hidden.

    Over the socket it named, which it answers by the pid of whoever
    connects: this process gets its own run and nothing else does. Without
    that variable (a developer running the runner by hand, or a platform
    with no such socket) the payload comes on stdin as it used to.
    """
    channel = os.environ.get("NLPGO_CODE_BLOCK_CHANNEL")
    if not channel:
        return sys.stdin.read()

    import socket

    chunks = []
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(_PAYLOAD_TIMEOUT_S)
        sock.connect("\0" + channel)
        while True:
            chunk = sock.recv(1 << 16)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks).decode("utf-8")


def main() -> int:
    try:
        raw = read_payload()
    except OSError as e:
        sys.stderr.write(f"runner: could not read the payload: {e}\n")
        return 1
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        # No result path to write to: it arrives in the payload that just
        # failed to parse, so this one goes to stderr, which nlpgo reads
        # when no result file turns up.
        sys.stderr.write(f"runner: invalid JSON in the payload: {e}\n")
        return 1

    # The run's own directory, which this process is not started in: a
    # working directory is readable from /proc, and in the moment before
    # the hiding above it would have named the run. Relative paths in user
    # code resolve here, as they always did.
    work_dir = payload.get("work_dir")
    if work_dir:
        os.chdir(work_dir)

    result_path = payload.get("result_path")
    nonce = payload.get("nonce", "")
    if not result_path:
        sys.stderr.write("runner: payload carries no result_path\n")
        return 2

    # The run's own environment: its credential, its scratch directory and
    # the token nlpgo's teardown recognizes its processes by. Set here
    # rather than handed to this process by exec, so none of it sits in
    # the initial environment another execution can read out of /proc.
    for name, value in (payload.get("env") or {}).items():
        os.environ[str(name)] = str(value)

    stub_source = payload.get("dspy_stub")
    if not stub_source:
        write_result(result_path, nonce, error={
            "type": "ProtocolError",
            "message": "payload carries no dspy_stub source",
            "traceback": "",
        })
        return 1
    install_dspy_stub(stub_source)

    code = payload.get("code", "")
    inputs = payload.get("inputs", {}) or {}
    declared_outputs = payload.get("outputs", []) or []
    secrets = payload.get("secrets", {}) or {}
    params = payload.get("params", {}) or {}

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    started = time.perf_counter()
    error = None
    outputs: dict = {}

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            module_globals: dict = {"__name__": "__user_code__"}
            # Expose project secrets as `secrets.NAME` attribute access.
            # Injected as a global (not a source preamble) so user-code
            # line numbers in tracebacks stay accurate. Left undefined
            # when there are no secrets — parity with the Python
            # executor's build_secrets_preamble, which is a no-op on an
            # empty/None map (so `secrets.X` with nothing configured
            # raises NameError on both engines).
            if secrets:
                module_globals["secrets"] = SimpleNamespace(**secrets)
            # Expose the run's parameters as `params.NAME`, injected the
            # same way and left undefined when there are none, so an
            # unconfigured `params.X` raises NameError exactly as an
            # unconfigured `secrets.X` does. Values arrive typed, so a
            # number stays a number and a boolean stays a boolean.
            if params:
                module_globals["params"] = SimpleNamespace(**params)
            exec(compile(code, _USER_CODE_FILENAME, "exec"), module_globals)
            result = _invoke_user_entrypoint(module_globals, inputs)
            result = _coerce_result(result)
            # Validate declared outputs are present (these are wired to
            # downstream nodes; missing them is a contract violation).
            for name in declared_outputs:
                if name not in result:
                    raise KeyError(f"missing_output: {name}")
            # Pass ALL keys through, not just the declared ones. The
            # Studio UI surfaces extra keys ad-hoc — operator-debug
            # returns like `{"output": ..., "dspy": repr(dspy)}` need
            # the diagnostic key visible in the panel even when only
            # "output" is on the node's declared outputs. Filtering
            # would silently drop them.
            outputs = dict(result)
    except Exception as exc:  # noqa: BLE001 — sandbox runner intentionally catches every user-code exception so Go can render a structured error in Studio
        error = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": format_user_traceback(),
        }

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    write_result(
        result_path,
        nonce,
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


def write_result(path, nonce, **fields):
    """Write the result file, stamped with the nonce from the payload.

    nlpgo reads a result only when the stamp matches, so a file written
    by anything that never saw the payload is not read as this run's
    output.
    """
    payload = {
        "outputs": fields.get("outputs", {}),
        "stdout": fields.get("stdout", ""),
        "stderr": fields.get("stderr", ""),
        "duration_ms": fields.get("duration_ms", 0),
        "error": fields.get("error"),
        "nonce": nonce,
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
