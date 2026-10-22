"""The guest half of the code-block host bridge.

A WASI guest has no sockets, so every outbound call is a request to the Go
engine: one framed line out on fd 1, one JSON line back on fd 0. The engine
applies the deployment's egress policy; see codeblock/bridge.go.
"""

from __future__ import annotations

import base64
import json
import sys

FRAME_PREFIX = "\x1eLWHOST "


class HostError(Exception):
    """The engine refused or failed a host call."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def call(op: str, **args):
    out = sys.__stdout__
    out.write(FRAME_PREFIX + json.dumps({"op": op, **args}) + "\n")
    out.flush()
    line = sys.__stdin__.readline()
    if not line:
        raise HostError("bridge", "the engine closed the host bridge")
    reply = json.loads(line)
    if not reply.get("ok"):
        raise HostError(reply.get("kind", "error"), reply.get("error", "host call failed"))
    return reply


def fetch(method: str, url: str, headers=None, body: bytes | None = None, timeout=None):
    """Perform one HTTP request through the engine. Returns the reply dict."""
    reply = call(
        "fetch",
        method=method.upper(),
        url=url,
        headers={str(k): str(v) for k, v in (headers or {}).items()},
        body_b64=base64.b64encode(body).decode("ascii") if body else "",
        timeout=float(timeout) if timeout is not None else 0,
    )
    reply["body"] = base64.b64decode(reply.get("body_b64") or "")
    return reply
