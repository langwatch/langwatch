"""
Signed calls for braids, wire format version 1 of ADR-185 section 4
(dev/docs/adr/185-braids-show-matching-spans-in-another-projects-traces.md).

The calling side signs the baggage entries it names with ``sign_baggage``;
the called side adds ``BraidBaggageSpanProcessor`` (or passes
``braid_copy_entries`` to ``langwatch.setup``) so every span carries the
entries and ``langwatch.signature``. The pinned test vector in the
TypeScript and Go SDKs asserts the same signature string as this module.
"""

import base64
import hashlib
import hmac
import json
import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Literal

from opentelemetry import baggage, trace
from opentelemetry.context import Context, attach, detach, get_current
from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor

BRAID_SIGNATURE_KEY = "langwatch.signature"
"""The baggage entry, and the span attribute, the signature travels as."""

BRAID_SIGNATURE_DOMAIN = "langwatch-braid-signature-v1"
"""The first line of every signed message, naming the wire format version."""

BRAID_ENTRY_KEY_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}")

_SIGNING_KEY_PREFIX = "lwsk_"
_PUBLIC_ID_PATTERN = re.compile(r"[A-Za-z0-9]+")

BraidSigningErrorCode = Literal[
    "malformed_signing_key",
    "empty_entries",
    "invalid_entry_key",
    "invalid_entry_value",
    "no_active_trace",
]


class BraidSigningError(ValueError):
    """Signing or copying was refused. Branch on ``code``, not the message."""

    def __init__(self, code: BraidSigningErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: BraidSigningErrorCode = code


def _assert_entry_key(key: object) -> None:
    if (
        not isinstance(key, str)
        or BRAID_ENTRY_KEY_PATTERN.fullmatch(key) is None
        or key == BRAID_SIGNATURE_KEY
    ):
        raise BraidSigningError(
            "invalid_entry_key",
            f"Braid entry key {key!r} must match [A-Za-z0-9._-]{{1,128}} "
            f"and not be {BRAID_SIGNATURE_KEY}",
        )


def _public_id_of(signing_key: str) -> str:
    rest = (
        signing_key[len(_SIGNING_KEY_PREFIX) :]
        if isinstance(signing_key, str) and signing_key.startswith(_SIGNING_KEY_PREFIX)
        else ""
    )
    separator = rest.find("_")
    public_id = rest[: max(separator, 0)]
    if (
        separator <= 0
        or separator == len(rest) - 1
        or _PUBLIC_ID_PATTERN.fullmatch(public_id) is None
    ):
        raise BraidSigningError(
            "malformed_signing_key",
            "Signing key must have the form lwsk_<publicId>_<secret>, publicId in [A-Za-z0-9]",
        )
    return public_id


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def compute_braid_signature(
    signing_key: str, trace_id: str, entries: Mapping[str, str]
) -> str:
    """The ``langwatch.signature`` value for these entries in this trace."""
    kid = _public_id_of(signing_key)
    if not entries:
        raise BraidSigningError(
            "empty_entries", "A braid signature needs at least one entry"
        )
    for key, value in entries.items():
        _assert_entry_key(key)
        if not isinstance(value, str) or "\n" in value or "\r" in value:
            raise BraidSigningError(
                "invalid_entry_value",
                f"Braid entry {key} must be a string without line breaks",
            )
    # Python orders str by code point, as wire format v1 requires.
    keys = sorted(entries)
    message = "\n".join(
        [BRAID_SIGNATURE_DOMAIN, trace_id.lower()]
        + [f"{key}={entries[key]}" for key in keys]
    )
    sig = _b64url(
        hmac.new(
            signing_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
        ).digest()
    )
    envelope = json.dumps(
        {"v": 1, "kid": kid, "keys": keys, "sig": sig},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return _b64url(envelope.encode("utf-8"))


def sign_baggage(
    signing_key: str,
    entries: Mapping[str, str],
    context: Context | None = None,
) -> Context:
    """
    Put each entry in baggage under its own key, plus ``langwatch.signature``
    over the context's trace id, and return the new context. Uses the current
    context when none is given; attach the result, or use ``signed_baggage``.
    """
    ctx = context if context is not None else get_current()
    span_context = trace.get_current_span(ctx).get_span_context()
    if not span_context.is_valid:
        raise BraidSigningError(
            "no_active_trace",
            "sign_baggage needs a context holding a valid span: the signature covers its trace id",
        )
    signature = compute_braid_signature(
        signing_key, format(span_context.trace_id, "032x"), entries
    )
    for key, value in entries.items():
        ctx = baggage.set_baggage(key, value, ctx)
    return baggage.set_baggage(BRAID_SIGNATURE_KEY, signature, ctx)


@contextmanager
def signed_baggage(signing_key: str, entries: Mapping[str, str]) -> Iterator[Context]:
    """Run the ``with`` block with the entries signed into the current baggage."""
    token = attach(sign_baggage(signing_key, entries))
    try:
        yield get_current()
    finally:
        detach(token)


class BraidBaggageSpanProcessor(SpanProcessor):
    """
    On span start, sets each named baggage entry, and ``langwatch.signature``
    when present, as a span attribute of the same name.
    """

    def __init__(self, copy_entries: Sequence[str]) -> None:
        for key in copy_entries:
            _assert_entry_key(key)
        self._keys: list[str] = [*copy_entries, BRAID_SIGNATURE_KEY]

    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        entries = baggage.get_all(parent_context)
        for key in self._keys:
            value = entries.get(key)
            if isinstance(value, str):
                span.set_attribute(key, value)

    def on_end(self, span: ReadableSpan) -> None:
        pass

    def shutdown(self) -> None:
        pass

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True
