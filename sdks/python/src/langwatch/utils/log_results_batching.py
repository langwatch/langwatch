"""
Sizes ``log_results`` requests by bytes.

Experiment results are batched by time, and one row can carry megabytes of
inline images. A batch above the request target is sent as several requests,
each holding whole entries in their original order.
"""

import json
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

from langwatch.utils.transformation import SerializableWithStringFallback

# The most bytes of entries one log_results request carries, unless a single
# entry is larger than this on its own. It stays under the request limit of
# every server version an SDK can talk to.
LOG_RESULTS_TARGET_BYTES = 16 * 1024 * 1024

# The keys of a log_results body that hold entries, in the order they are sent.
_ENTRY_KEYS = ("dataset", "evaluations")

# The timestamps that mark a run as over. They travel with the last request only.
_END_TIMESTAMPS = ("finished_at", "stopped_at")

_Entry = Tuple[str, Any, int]


class LogResultsTooLargeError(Exception):
    """Raised when the server refuses a single experiment result as too large."""

    def __init__(self, message: str, *, entry_bytes: int) -> None:
        super().__init__(message)
        self.entry_bytes = entry_bytes


def is_payload_too_large(error: BaseException) -> bool:
    """Whether an error is the server refusing a request body for its size."""
    return (
        isinstance(error, httpx.HTTPStatusError)
        and error.response.status_code == 413
    )


def _serialized_bytes(value: Any) -> int:
    return len(json.dumps(value, cls=SerializableWithStringFallback))


def _entries_of(body: Dict[str, Any]) -> List[_Entry]:
    return [
        (key, entry, _serialized_bytes(entry))
        for key in _ENTRY_KEYS
        for entry in body.get(key) or []
    ]


def _parts_of(body: Dict[str, Any], groups: List[List[_Entry]]) -> List[Dict[str, Any]]:
    """One request body per group of entries.

    Every part repeats the run's own fields. The targets go with the first
    part, and the timestamps that end the run go with the last one.
    """
    parts: List[Dict[str, Any]] = []
    for position, group in enumerate(groups):
        part = {
            key: value
            for key, value in body.items()
            if key not in _ENTRY_KEYS and key != "targets"
        }
        for key in _ENTRY_KEYS:
            if key in body:
                part[key] = [entry for entry_key, entry, _ in group if entry_key == key]
        if position == 0 and "targets" in body:
            part["targets"] = body["targets"]
        if position < len(groups) - 1 and isinstance(body.get("timestamps"), dict):
            part["timestamps"] = {
                key: value
                for key, value in body["timestamps"].items()
                if key not in _END_TIMESTAMPS
            }
        parts.append(part)
    return parts


def split_log_results_body(
    body: Dict[str, Any], *, target_bytes: int = LOG_RESULTS_TARGET_BYTES
) -> List[Dict[str, Any]]:
    """Split a log_results body into requests of at most ``target_bytes`` of entries.

    Entries keep their order. An entry larger than the target is sent alone.
    A body that already fits is returned as it is.
    """
    entries = _entries_of(body)
    if sum(size for _, _, size in entries) <= target_bytes:
        return [body]

    groups: List[List[_Entry]] = []
    group_bytes = 0
    for entry in entries:
        if not groups or group_bytes + entry[2] > target_bytes:
            groups.append([])
            group_bytes = 0
        groups[-1].append(entry)
        group_bytes += entry[2]
    return _parts_of(body, groups)


def _byte_midpoint(entries: List[_Entry]) -> int:
    """Where to cut a list of entries so both sides hold about half the bytes."""
    half = sum(size for _, _, size in entries) / 2
    read = 0
    for position, (_, _, size) in enumerate(entries):
        read += size
        if read >= half:
            return min(max(position + 1, 1), len(entries) - 1)
    return len(entries) - 1


def _describe(entry: _Entry) -> str:
    key, value, _ = entry
    index = value.get("index") if isinstance(value, dict) else None
    kind = "evaluation result" if key == "evaluations" else "result"
    return f"The {kind} for row index {index}" if index is not None else f"One {kind}"


def send_log_results_in_parts(
    body: Dict[str, Any],
    *,
    post: Callable[[Dict[str, Any]], None],
    target_bytes: int = LOG_RESULTS_TARGET_BYTES,
) -> None:
    """Send a log_results body as one or more requests, in order.

    A request the server refuses as too large is cut in two halves by bytes
    and sent again.
    When a single entry is refused, the rest is still sent and the refusal is
    raised at the end as a ``LogResultsTooLargeError`` that names the entry.
    """
    refusal: Optional[LogResultsTooLargeError] = None

    def send(part: Dict[str, Any]) -> None:
        nonlocal refusal
        try:
            post(part)
        except httpx.HTTPStatusError as error:
            if not is_payload_too_large(error):
                raise
            entries = _entries_of(part)
            if len(entries) > 1:
                middle = _byte_midpoint(entries)
                for half in _parts_of(part, [entries[:middle], entries[middle:]]):
                    send(half)
                return
            if not entries:
                raise
            megabytes = entries[0][2] / (1024 * 1024)
            refused = LogResultsTooLargeError(
                f"{_describe(entries[0])} is {megabytes:.1f} MB when serialized, "
                "and LangWatch refused it as too large for one request (HTTP 413). "
                "It was not logged. Make the row's entry, output or evaluation "
                "inputs smaller, for example by sending images as URLs.",
                entry_bytes=entries[0][2],
            )
            refused.__cause__ = error
            refusal = refusal or refused
            # The run's closing timestamps were on this request: send them on their own.
            if any(key in (part.get("timestamps") or {}) for key in _END_TIMESTAMPS):
                post({**part, **{key: [] for key in _ENTRY_KEYS if key in part}})

    for part in split_log_results_body(body, target_bytes=target_bytes):
        send(part)

    if refusal is not None:
        raise refusal
