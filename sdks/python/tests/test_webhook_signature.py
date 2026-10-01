"""
The Python verifier, held to the sender's own arithmetic.

The cases are not written here. They are read from
``specs/webhooks/signature-vectors.json``, which is generated from the
server's signing code by
``apps/worker/src/tasks/webhook-signature-vectors.entrypoint.ts`` and asserted
against that code by a suite on the platform side. Three implementations
agreeing with their own local idea of the algorithm is not agreement, so
this suite and the TypeScript one read the SAME file and neither can be
made green by editing it.

Spec: specs/webhooks/sdk-signature-verification.feature
"""

import json
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

from langwatch import (
    WEBHOOK_DELIVERY_ID_HEADER,
    WEBHOOK_EVENT_ID_HEADER,
    WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS,
    WEBHOOK_SIGNATURE_HEADER,
    WebhookSignatureExpiredError,
    WebhookSignatureVerificationError,
    verify_webhook_signature,
)

# Repo root, four levels up from sdks/python/tests/.
VECTORS_PATH = (
    Path(__file__).resolve().parents[3] / "specs/webhooks/signature-vectors.json"
)

VECTORS: Dict[str, Any] = json.loads(VECTORS_PATH.read_text())
VERIFICATION: List[Dict[str, Any]] = VECTORS["verification"]


def outcome_of(vector: Dict[str, Any]) -> str:
    """Run the verifier and report what a receiver would have concluded."""
    kwargs: Dict[str, Any] = {}
    if vector.get("tolerance_seconds") is not None:
        kwargs["tolerance_seconds"] = vector["tolerance_seconds"]
    try:
        verify_webhook_signature(
            body=vector["body"],
            header=vector["header"],
            secret=vector["secrets"],
            now_seconds=vector["now_seconds"],
            **kwargs,
        )
        return "valid"
    except WebhookSignatureVerificationError as error:
        return error.code


def test_vector_file_actually_carries_cases():
    # A path typo would otherwise make the parametrized suite read as green.
    assert len(VERIFICATION) > 15
    assert len(VECTORS["signing"]) > 3


def test_header_names_match_the_sender():
    """Hand-copied header names are how a receiver ends up keying idempotency
    off a header that no longer exists, processing every retry twice."""
    assert WEBHOOK_SIGNATURE_HEADER == VECTORS["headers"]["signature"]
    assert WEBHOOK_DELIVERY_ID_HEADER == VECTORS["headers"]["delivery_id"]
    assert WEBHOOK_EVENT_ID_HEADER == VECTORS["headers"]["event_id"]


def test_default_tolerance_matches_the_sender():
    assert (
        WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS
        == VECTORS["default_tolerance_seconds"]
    )


# @scenario Both SDK verifiers reach the sender's verdict on every generated case
@pytest.mark.parametrize("vector", VERIFICATION, ids=lambda v: v["name"])
def test_verifier_agrees_with_the_generated_vectors(vector: Dict[str, Any]):
    assert outcome_of(vector) == vector["expected"], vector["why"]


# @scenario Both SDK verifiers reach the sender's verdict on every generated case
def test_all_four_verdicts_are_exercised():
    """A vector file that only carried happy cases would read as green while
    proving nothing about the three refusals."""
    assert sorted({outcome_of(v) for v in VERIFICATION}) == [
        "invalid_signature",
        "malformed_header",
        "stale_timestamp",
        "valid",
    ]


def _vector(name: str) -> Dict[str, Any]:
    return next(v for v in VERIFICATION if v["name"] == name)


# @scenario A delivery signed with a secret the receiver holds is accepted
def test_accepts_a_delivery_signed_with_the_secret_held():
    assert outcome_of(_vector("valid_single_secret")) == "valid"


# @scenario A body changed in transit is refused as a bad signature
def test_refuses_a_tampered_body_as_a_signature_mismatch():
    assert outcome_of(_vector("invalid_signature_tampered_body")) == "invalid_signature"


# @scenario A delivery outside the freshness window is refused as stale
def test_refuses_a_late_delivery_as_stale():
    assert outcome_of(_vector("stale_timestamp_in_the_past")) == "stale_timestamp"


# @scenario A signature header the receiver cannot parse is refused as malformed
def test_refuses_an_unparseable_header_as_malformed():
    assert outcome_of(_vector("malformed_header_garbage")) == "malformed_header"


# @scenario During a secret rotation either secret the receiver holds verifies the delivery
def test_rotation_verifies_under_whichever_secret_the_receiver_holds():
    """The header carries one signature per valid secret. All three receivers
    must take delivery, or a rotation drops traffic."""
    assert outcome_of(_vector("valid_rotation_receiver_holds_new_only")) == "valid"
    assert outcome_of(_vector("valid_rotation_receiver_holds_old_only")) == "valid"
    assert outcome_of(_vector("valid_rotation_receiver_holds_both")) == "valid"


def test_takes_a_bare_string_secret():
    """The ordinary steady-state call holds one secret, not a list."""
    vector = _vector("valid_single_secret")
    verify_webhook_signature(
        body=vector["body"],
        header=vector["header"],
        secret=vector["secrets"][0],
        now_seconds=vector["now_seconds"],
    )


# @scenario The exact bytes received are what gets verified
def test_verifies_raw_bytes_exactly_as_it_verifies_the_string():
    """Frameworks hand a receiver bytes; re-encoding them would be the very
    mistake the helper exists to prevent."""
    vector = _vector("valid_unicode_body")
    verify_webhook_signature(
        body=vector["body"].encode("utf-8"),
        header=vector["header"],
        secret=vector["secrets"],
        now_seconds=vector["now_seconds"],
    )


# @scenario A receiver with no secret configured is told its configuration is wrong
def test_missing_secret_blames_the_configuration():
    """A receiver that lost its secret must not read as 'every delivery is
    being tampered with', which is what a mismatch would say."""
    vector = _vector("valid_single_secret")
    with pytest.raises(TypeError):
        verify_webhook_signature(
            body=vector["body"],
            header=vector["header"],
            secret=["", ""],
            now_seconds=vector["now_seconds"],
        )


def test_defaults_to_the_system_clock():
    """The vectors are timestamped in the past, so with the real clock the
    same delivery must read as stale."""
    vector = _vector("valid_single_secret")
    assert int(time.time()) > vector["now_seconds"]
    with pytest.raises(WebhookSignatureExpiredError):
        verify_webhook_signature(
            body=vector["body"],
            header=vector["header"],
            secret=vector["secrets"],
        )
