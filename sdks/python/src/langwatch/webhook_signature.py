"""
Receiver-side verification of a LangWatch webhook delivery.

Every delivery carries::

    X-LangWatch-Signature: t=<unix seconds>,v1=<hex hmac-sha256>[,v1=<hex>]

where each ``v1`` is HMAC-SHA256 over ``"<t>.<raw body>"`` under one
currently valid signing secret. ``v1`` REPEATS during a secret rotation,
newest first, which is what lets a receiver swap secrets on its own
schedule instead of dropping deliveries mid-swap.

That repetition is the reason this helper exists. A hand-rolled parser that
builds a dict from the header, or keeps the LAST ``v1`` it sees, rejects
every delivery to a receiver that has already moved to the new secret: the
signature it kept is the one computed from the OLD secret. The bug only
appears during a rotation, which is exactly when a receiver can least
afford to be dropping deliveries.

This module deliberately imports nothing beyond the standard library, so a
receiver can verify a delivery without paying for the rest of the SDK.
The algorithm is pinned to the sender's by the vectors in
``specs/webhooks/signature-vectors.json``, generated from the server's own
signing code.
"""

import hashlib
import hmac
import time
from typing import List, Optional, Sequence, Union

__all__ = [
    "WEBHOOK_SIGNATURE_HEADER",
    "WEBHOOK_DELIVERY_ID_HEADER",
    "WEBHOOK_EVENT_ID_HEADER",
    "WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS",
    "WebhookSignatureVerificationError",
    "WebhookSignatureHeaderError",
    "WebhookSignatureExpiredError",
    "WebhookSignatureMismatchError",
    "verify_webhook_signature",
]

WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature"
"""The header a delivery carries its signature in."""

WEBHOOK_DELIVERY_ID_HEADER = "X-LangWatch-Delivery-Id"
"""Identifies one delivery ATTEMPT on the webhook platform's endpoints.

The natural idempotency key for a receiver: retries of the same batch repeat
it, so a receiver that has already processed this id can acknowledge and stop
rather than applying the batch twice."""

WEBHOOK_EVENT_ID_HEADER = "X-LangWatch-Event-Id"
"""The same role on automation deliveries (graph alerts and friends), which
group their attempts by the logical fire rather than by the batch.

Two names because they are two senders: read whichever the delivery carries."""

WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS = 300
"""How far a delivery's timestamp may sit from the receiver's clock, in
seconds. Matches the sender's documented window."""


class WebhookSignatureVerificationError(ValueError):
    """A delivery that did not verify.

    Catch this to refuse every unverifiable delivery alike, or catch one of
    the three subclasses to tell the reasons apart. ``code`` carries the
    same string the TypeScript SDK puts on its error, so both languages
    describe a refusal identically.
    """

    code = "invalid_signature"

    def __init__(self, message: str) -> None:
        super().__init__(message)


class WebhookSignatureHeaderError(WebhookSignatureVerificationError):
    """The header was absent or not the signature scheme at all.

    Almost always something other than LangWatch posting to the URL.
    """

    code = "malformed_header"


class WebhookSignatureExpiredError(WebhookSignatureVerificationError):
    """The signature was well formed but outside the freshness window.

    A clock that drifted, or a replay. Worth alerting on either way.
    """

    code = "stale_timestamp"


class WebhookSignatureMismatchError(WebhookSignatureVerificationError):
    """No signature in the header matched a secret this receiver holds.

    A wrong secret, a secret that has rolled off, or a body that changed in
    transit.
    """

    code = "invalid_signature"


def _parse_header(header: str) -> tuple:
    """The timestamp and EVERY ``v1`` the header carries, in the order sent.

    Returns ``(timestamp, candidates)`` where ``timestamp`` is ``None`` when
    the header carried no readable ``t``. Every ``v1`` is kept: keeping only
    one is the rotation bug this module exists to make impossible.
    """
    timestamp: Optional[int] = None
    candidates: List[str] = []
    for piece in header.split(","):
        key, sep, value = piece.partition("=")
        if not sep:
            continue
        key = key.strip()
        value = value.strip()
        if key == "v1":
            candidates.append(value)
        elif key == "t" and value:
            try:
                timestamp = int(value)
            except ValueError:
                # A `t` that is not a number fails parsing rather than being
                # coerced to an epoch a freshness check would then trust.
                timestamp = None
    return timestamp, candidates


def verify_webhook_signature(
    *,
    body: Union[str, bytes],
    header: str,
    secret: Union[str, Sequence[str]],
    tolerance_seconds: int = WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS,
    now_seconds: Optional[int] = None,
) -> None:
    """Verify a webhook delivery, or raise explaining which check failed.

    ::

        from langwatch import verify_webhook_signature

        @app.post("/langwatch")
        async def receive(request: Request):
            try:
                verify_webhook_signature(
                    body=await request.body(),  # raw bytes, before JSON parsing
                    header=request.headers.get("X-LangWatch-Signature", ""),
                    secret=[NEW_SECRET, OLD_SECRET],
                )
            except WebhookSignatureVerificationError as error:
                raise HTTPException(status_code=400, detail=error.code)
            # Trusted from here.

    :param body: The EXACT bytes of the request body, as received. Not a
        parsed object and not the result of re-serializing one: the digest
        is over the bytes the sender hashed, and a JSON round trip reorders
        keys, drops whitespace and re-escapes non-ASCII, any of which
        changes the digest.
    :param header: The ``X-LangWatch-Signature`` value, verbatim.
    :param secret: The signing secret, or every secret this receiver
        currently accepts. Pass both during a rotation and the delivery
        verifies under either, so there is no window where deliveries are
        refused.
    :param tolerance_seconds: Freshness window, defaulting to the sender's
        five minutes.
    :param now_seconds: Current unix time in SECONDS. Defaults to the system
        clock; pass it to verify a delivery captured earlier, or from a test.

    Raises rather than returning ``False`` so that a delivery cannot be
    trusted by forgetting to check a return value. Checks run in a fixed
    order, so a delivery that is both stale and wrongly signed reports the
    staleness: a header that did not parse has no trustworthy timestamp to
    judge, and a timestamp outside the window makes the digest moot.

    A missing or empty secret is a configuration mistake rather than a bad
    delivery, and raises ``TypeError``. Reporting it as a failed
    verification would let a receiver that lost its secret quietly refuse
    every delivery as if the sender were at fault.
    """
    secrets = [secret] if isinstance(secret, str) else list(secret)
    usable = [value for value in secrets if isinstance(value, str) and value]
    if not usable:
        raise TypeError(
            "verify_webhook_signature needs at least one non-empty signing secret"
        )

    timestamp, candidates = _parse_header(header)
    if timestamp is None:
        raise WebhookSignatureHeaderError(
            f"{WEBHOOK_SIGNATURE_HEADER} carries no readable t= timestamp, "
            "so the delivery cannot be checked for freshness"
        )
    if not candidates:
        raise WebhookSignatureHeaderError(
            f"{WEBHOOK_SIGNATURE_HEADER} carries no v1= signature, "
            "so there is nothing to compare"
        )

    now = int(time.time()) if now_seconds is None else now_seconds
    drift = abs(now - timestamp)
    if drift > tolerance_seconds:
        raise WebhookSignatureExpiredError(
            f"the delivery was signed {drift}s from now, "
            f"outside the {tolerance_seconds}s tolerance"
        )

    payload = b"%d." % timestamp + (
        body.encode("utf-8") if isinstance(body, str) else bytes(body)
    )
    matched = False
    for value in usable:
        expected = hmac.new(
            value.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest()
        for candidate in candidates:
            # Every pair is compared even once one has matched, so the work
            # does not depend on WHICH secret or which v1 was the right one.
            if hmac.compare_digest(expected, candidate):
                matched = True

    if not matched:
        held = "secret" if len(usable) == 1 else "secrets"
        raise WebhookSignatureMismatchError(
            f"no v1 signature in {WEBHOOK_SIGNATURE_HEADER} matched the {held} held, "
            "so the body was signed with something else or changed in transit"
        )
