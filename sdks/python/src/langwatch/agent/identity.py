"""Environment and instance identity of a connected agent process.

The platform keys an agent row by name and environment, and lists the
instances of a row by hostname, username, pid and label. Every lookup here
is defensive: a sandbox without a hostname or a container whose uid has no
passwd entry gives an empty string, never an exception.
"""

from __future__ import annotations

import getpass
import os
import re
import socket
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .protocol import InstanceInfo

DEFAULT_ENVIRONMENT = "development"

ENVIRONMENT_VARIABLES = (
    "LANGWATCH_AGENT_ENVIRONMENT",
    "APP_ENV",
    "ENVIRONMENT",
    "NODE_ENV",
)

CONNECT_VARIABLE = "LANGWATCH_AGENT_CONNECT"
INSTANCE_LABEL_VARIABLE = "LANGWATCH_AGENT_INSTANCE_LABEL"

MAX_ENVIRONMENT_LENGTH = 64
MAX_LABEL_LENGTH = 64
MAX_HOST_LABEL_LENGTH = 24

_FALSE_VALUES = frozenset({"0", "false", "no", "off"})
_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})

_HOST_SUFFIX_RE = re.compile(r"\.(local|lan|home|localdomain)$", re.IGNORECASE)
_NOT_HOST_CHARS_RE = re.compile(r"[^a-z0-9-]+")
_NOT_ENVIRONMENT_CHARS_RE = re.compile(r"[^a-z0-9_.-]+")
_EDGE_DASHES_RE = re.compile(r"^-+|-+$")


def sanitize_environment(value: str | None) -> str:
    """Lowercase, replace symbols and spaces with dashes, cap the length.

    An empty result falls back to `development`.
    """
    if value is None:
        return DEFAULT_ENVIRONMENT
    cleaned = _NOT_ENVIRONMENT_CHARS_RE.sub("-", value.strip().lower())
    cleaned = _EDGE_DASHES_RE.sub("", cleaned)[:MAX_ENVIRONMENT_LENGTH]
    cleaned = _EDGE_DASHES_RE.sub("", cleaned)
    return cleaned or DEFAULT_ENVIRONMENT


def resolve_environment(explicit: str | None = None) -> str:
    """The explicit argument, then the environment variables in order."""
    if explicit is not None and explicit.strip():
        return sanitize_environment(explicit)
    for variable in ENVIRONMENT_VARIABLES:
        value = os.environ.get(variable)
        if value is not None and value.strip():
            return sanitize_environment(value)
    return DEFAULT_ENVIRONMENT


def _flag_from_environment(variable: str) -> bool | None:
    raw = os.environ.get(variable)
    if raw is None:
        return None
    value = raw.strip().lower()
    if value in _FALSE_VALUES:
        return False
    if value in _TRUE_VALUES:
        return True
    return None


def ci_is_truthy() -> bool:
    raw = os.environ.get("CI")
    if raw is None:
        return False
    return raw.strip().lower() not in ("", *_FALSE_VALUES)


def resolve_enabled(explicit: bool | None = None) -> bool:
    """`LANGWATCH_AGENT_CONNECT=0` always disables.

    Otherwise the explicit argument decides; with no argument the connection
    is on, except when `CI` is truthy.
    """
    from_variable = _flag_from_environment(CONNECT_VARIABLE)
    if from_variable is False:
        return False
    if explicit is not None:
        return explicit
    if from_variable is True:
        return True
    return not ci_is_truthy()


def sanitize_label(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())[:MAX_LABEL_LENGTH].strip()
    return cleaned or None


def resolve_instance_label(explicit: str | None = None) -> str | None:
    """The explicit argument, then `LANGWATCH_AGENT_INSTANCE_LABEL`."""
    label = sanitize_label(explicit)
    if label is not None:
        return label
    return sanitize_label(os.environ.get(INSTANCE_LABEL_VARIABLE))


def machine_hostname() -> str:
    try:
        return socket.gethostname() or ""
    except Exception:
        return ""


def machine_username() -> str:
    try:
        return getpass.getuser() or ""
    except Exception:
        return ""


def host_label(hostname: str | None = None) -> str:
    """A short label for this machine: lowercase, `[a-z0-9-]`, 24 characters.

    The platform scopes a development agent connected with a project key to
    this label, so it has the same shape as the label the CLI attaches to the
    keys it mints.
    """
    raw = (hostname if hostname is not None else machine_hostname()).lower()
    cleaned = _HOST_SUFFIX_RE.sub("", raw)
    cleaned = _NOT_HOST_CHARS_RE.sub("-", cleaned)
    cleaned = _EDGE_DASHES_RE.sub("", cleaned)
    return cleaned[:MAX_HOST_LABEL_LENGTH]


def new_instance_id() -> str:
    return uuid.uuid4().hex


@dataclass
class InstanceIdentity:
    """What the platform shows for one connected process."""

    id: str = field(default_factory=new_instance_id)
    hostname: str = field(default_factory=machine_hostname)
    username: str = field(default_factory=machine_username)
    pid: int = field(default_factory=os.getpid)
    started_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    label: str | None = None

    def to_frame(self, *, in_flight_call_ids: list[str]) -> InstanceInfo:
        info: InstanceInfo = {
            "id": self.id,
            "hostname": host_label(self.hostname),
            "username": self.username,
            "pid": self.pid,
            "startedAt": self.started_at,
            "inFlightCallIds": list(in_flight_call_ids),
        }
        if self.label:
            info["label"] = self.label
        return info
