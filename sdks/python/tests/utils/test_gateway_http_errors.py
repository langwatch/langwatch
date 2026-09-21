"""Unit coverage for what a refused gateway call tells the caller.

A refusal the platform wrote prose for has to reach the caller as that prose,
the way the TypeScript SDK surfaces it, and a 403 has to read as what it is:
the credential was accepted and this call is not allowed with it.

Spec: specs/errors/handled-error-surfaces.feature
"""

from __future__ import annotations

import httpx
import pytest

from langwatch.api_errors import (
    LangWatchApiAuthenticationError,
    LangWatchApiError,
)
from langwatch.utils.exceptions import extract_api_error_detail
from langwatch.utils.gateway_http import raise_for_status

pytestmark = pytest.mark.unit

PLAN_SENTENCE = (
    "The billing events API is an enterprise feature; this organization's "
    "plan does not include it."
)

FORBIDDEN_BODY = {
    "type": "permission_denied",
    "code": "forbidden",
    "message": PLAN_SENTENCE,
    "trace_id": "trace_01HZ",
}


def _refusal(status: int, body: object) -> httpx.Response:
    return httpx.Response(
        status,
        json=body,
        request=httpx.Request(
            "GET", "https://app.langwatch.ai/api/gateway/v1/spend-summaries"
        ),
    )


def _raised(status: int, body: object) -> LangWatchApiError:
    with pytest.raises(LangWatchApiError) as caught:
        raise_for_status(_refusal(status, body), operation="read spend summaries")
    return caught.value


class TestGivenThePlatformRefusesTheCallAndWritesWhy:
    class TestWhenTheEnvelopeIsTopLevel:
        # @scenario "A refusal the platform explained keeps its explanation in the SDK"
        def test_carries_the_platform_sentence(self) -> None:
            error = _raised(403, FORBIDDEN_BODY)

            assert PLAN_SENTENCE in str(error)

        def test_names_the_refusal_without_blaming_the_credential(self) -> None:
            error = _raised(403, FORBIDDEN_BODY)

            assert "authentication failed" not in str(error)
            assert "not permitted" in str(error)

        def test_keeps_the_platform_code_and_the_status_class(self) -> None:
            error = _raised(403, FORBIDDEN_BODY)

            assert error.code == "forbidden"
            assert error.status == 403
            assert isinstance(error, LangWatchApiAuthenticationError)

    class TestWhenTheEnvelopeIsNestedUnderError:
        # @scenario "A refusal keeps its explanation however the platform shapes the answer"
        def test_carries_the_same_platform_sentence(self) -> None:
            error = _raised(403, {"error": FORBIDDEN_BODY})

            assert PLAN_SENTENCE in str(error)
            assert "authentication failed" not in str(error)

        def test_reads_the_sentence_out_of_the_body_on_its_own(self) -> None:
            assert extract_api_error_detail({"error": FORBIDDEN_BODY}) == PLAN_SENTENCE


class TestGivenThePlatformRejectsTheCredentialItself:
    # @scenario "A refused credential still reads as an authentication failure"
    def test_keeps_the_authentication_failed_summary(self) -> None:
        error = _raised(401, {"error": "Unauthorized", "message": "Invalid API key"})

        assert "authentication failed" in str(error)
        assert "Invalid API key" in str(error)
        assert isinstance(error, LangWatchApiAuthenticationError)


class TestGivenAnEnvelopeThatDescribesNothing:
    def test_falls_back_to_the_status_summary_alone(self) -> None:
        error = _raised(403, {})

        assert str(error) == "read spend summaries: not permitted"
