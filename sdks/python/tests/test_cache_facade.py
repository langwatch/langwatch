"""Unit coverage for the agent cache facade.

Transport is a mounted httpx.MockTransport, so the tests assert on the calls
the facade makes rather than on a live API.

Spec: specs/agent-cache/agent-cache.feature
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.cache import CacheFacade


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


class CacheStub:
    """A project agent cache that answers the routes the facade calls."""

    def __init__(self, *, stored: Optional[Dict[str, str]] = None) -> None:
        self.stored: Dict[str, str] = dict(stored or {})
        self.calls: List[Tuple[str, str]] = []
        self.written_ttls: List[Optional[int]] = []
        # Set to a status to make every call answer with it instead.
        self.refuse_with: Optional[int] = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))

        if self.refuse_with is not None:
            return httpx.Response(
                self.refuse_with,
                json={
                    "error": {
                        "type": "internal_error",
                        "code": "internal_error",
                        "message": "internal_error",
                    }
                },
            )

        name = path.removeprefix("/api/agent-cache/").removesuffix("/claim")
        body: Dict[str, Any] = json.loads(request.content) if request.content else {}

        if request.method == "POST" and path.endswith("/claim"):
            claimed = name not in self.stored
            if claimed:
                self.stored[name] = body["value"]
                self.written_ttls.append(body.get("ttl_seconds"))
            return httpx.Response(
                200,
                json={
                    "name": name,
                    "claimed": claimed,
                    "ttl_seconds": body.get("ttl_seconds", 900),
                },
            )

        if request.method == "GET":
            if name not in self.stored:
                return httpx.Response(
                    404,
                    json={
                        "error": {
                            "type": "not_found",
                            "code": "cache_entry_not_found",
                            "message": "cache_entry_not_found",
                        }
                    },
                )
            return httpx.Response(200, json={"name": name, "value": self.stored[name]})

        if request.method == "PUT":
            self.stored[name] = body["value"]
            self.written_ttls.append(body.get("ttl_seconds"))
            return httpx.Response(
                200, json={"name": name, "ttl_seconds": body.get("ttl_seconds", 900)}
            )

        if request.method == "DELETE":
            self.stored.pop(name, None)
            return httpx.Response(200, json={"name": name, "deleted": True})

        raise AssertionError(f"unexpected call {request.method} {path}")


def facade_over(stub: CacheStub) -> CacheFacade:
    return CacheFacade(FakeRestClient(stub.handler))


class TestGet:
    # @scenario "The SDK answers a miss with the caller's default"
    def test_answers_the_default_when_the_project_holds_no_entry(self):
        stub = CacheStub()

        assert facade_over(stub).get("ACME_SESSION") is None
        assert facade_over(stub).get("ACME_SESSION", "fallback") == "fallback"

    def test_answers_the_stored_value(self):
        stub = CacheStub(stored={"ACME_SESSION": "session-1"})

        assert facade_over(stub).get("ACME_SESSION") == "session-1"
        assert ("GET", "/api/agent-cache/ACME_SESSION") in stub.calls

    # @scenario "The SDK raises on a refusal that is not a miss"
    def test_raises_on_a_refusal_that_is_not_a_miss(self):
        stub = CacheStub()
        stub.refuse_with = 500

        with pytest.raises(RuntimeError, match="500"):
            facade_over(stub).get("ACME_SESSION")


class TestSet:
    def test_stores_the_value(self):
        stub = CacheStub()

        facade_over(stub).set("ACME_SESSION", "session-1")

        assert stub.stored == {"ACME_SESSION": "session-1"}
        assert stub.written_ttls == [None]

    # @scenario "The SDK carries the lifetime the caller named"
    def test_carries_the_lifetime_the_caller_named(self):
        stub = CacheStub()

        facade_over(stub).set("ACME_SESSION", "session-1", ttl_seconds=840)

        assert stub.written_ttls == [840]

    def test_replaces_a_value_the_project_already_holds(self):
        stub = CacheStub(stored={"ACME_SESSION": "first"})

        facade_over(stub).set("ACME_SESSION", "second")

        assert stub.stored == {"ACME_SESSION": "second"}


class TestClaim:
    def test_takes_a_name_the_project_does_not_hold(self):
        stub = CacheStub()

        assert facade_over(stub).claim("ACME_SESSION", "session-1") is True
        assert stub.stored == {"ACME_SESSION": "session-1"}
        assert ("POST", "/api/agent-cache/ACME_SESSION/claim") in stub.calls

    # @scenario "The SDK answers a lost claim with false"
    def test_answers_false_when_the_name_is_already_held(self):
        stub = CacheStub(stored={"ACME_SESSION": "first"})

        assert facade_over(stub).claim("ACME_SESSION", "second") is False
        assert stub.stored == {"ACME_SESSION": "first"}

    def test_carries_the_lifetime_the_caller_named(self):
        stub = CacheStub()

        facade_over(stub).claim("ACME_SESSION", "session-1", ttl_seconds=840)

        assert stub.written_ttls == [840]


class TestDelete:
    def test_removes_the_entry(self):
        stub = CacheStub(stored={"ACME_SESSION": "session-1"})

        facade_over(stub).delete("ACME_SESSION")

        assert stub.stored == {}
        assert ("DELETE", "/api/agent-cache/ACME_SESSION") in stub.calls


class TestValuesThatAreNotText:
    # @scenario "The SDK stores a dict or list as JSON and reads it back parsed"
    def test_a_dict_is_stored_as_json_text_and_comes_back_as_a_dict(self):
        stub = CacheStub()
        session = {"token": "abc", "expires_at": 1787920000, "scopes": ["read"]}

        facade_over(stub).set("ACME_SESSION", session, ttl_seconds=837)

        assert stub.stored["ACME_SESSION"] == json.dumps(session)
        assert facade_over(stub).get("ACME_SESSION") == session

    def test_a_list_round_trips_the_same_way(self):
        stub = CacheStub()

        facade_over(stub).claim("ACME_HANDLES", ["h1", "h2"])

        assert stub.stored["ACME_HANDLES"] == '["h1", "h2"]'
        assert facade_over(stub).get("ACME_HANDLES") == ["h1", "h2"]

    def test_text_is_stored_and_read_back_untouched(self):
        stub = CacheStub()

        facade_over(stub).set("ACME_SESSION", "  a-session-token ")

        assert stub.stored["ACME_SESSION"] == "  a-session-token "
        assert facade_over(stub).get("ACME_SESSION") == "  a-session-token "

    def test_text_that_only_looks_like_json_comes_back_as_text(self):
        stub = CacheStub(stored={"ACME_NOTE": "{not json", "ACME_NUMBER": "42"})

        assert facade_over(stub).get("ACME_NOTE") == "{not json"
        assert facade_over(stub).get("ACME_NUMBER") == "42"

    # @scenario "JSON text an older writer stored reads back parsed"
    def test_json_text_an_older_writer_stored_reads_back_parsed(self):
        stub = CacheStub(
            stored={"ACME_MODE": '{"mode":"legacy"}', "ACME_STEPS": '["one"]'}
        )

        assert facade_over(stub).get("ACME_MODE") == {"mode": "legacy"}
        assert facade_over(stub).get("ACME_STEPS") == ["one"]

    # @scenario "The SDK refuses a value it cannot store before calling the platform"
    def test_a_value_of_another_type_is_refused_before_any_call(self):
        stub = CacheStub()

        with pytest.raises(TypeError) as raised:
            facade_over(stub).set("ACME_COUNT", 42)  # type: ignore[arg-type]

        assert "int" in str(raised.value)
        assert stub.calls == []

    def test_a_tuple_is_stored_as_a_json_array_and_reads_back_as_a_list(self):
        stub = CacheStub()

        facade_over(stub).set("ACME_HANDLES", {"items": ("a", "b")})

        assert stub.stored["ACME_HANDLES"] == '{"items": ["a", "b"]}'
        assert facade_over(stub).get("ACME_HANDLES") == {"items": ["a", "b"]}

    @pytest.mark.parametrize(
        "number", [float("nan"), float("inf"), float("-inf")]
    )
    def test_a_number_json_cannot_carry_is_refused_before_any_call(self, number):
        stub = CacheStub()

        with pytest.raises(TypeError):
            facade_over(stub).set("ACME_READING", {"value": number})

        assert stub.calls == []


class TestMessages:
    # @scenario "No message from the SDK quotes a cached value"
    def test_no_message_quotes_the_value_the_caller_sent(self):
        stub = CacheStub()
        stub.refuse_with = 403

        with pytest.raises(RuntimeError) as raised:
            facade_over(stub).set("ACME_SESSION", "a-session-nobody-may-print")

        assert "a-session-nobody-may-print" not in str(raised.value)

    # @scenario "A refused write names the field the platform rejected"
    def test_a_refused_write_names_the_rejected_field(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "code": "validation_error",
                    "message": "validation_error",
                    "meta": {"target": "json", "fields": ["value"]},
                    "reasons": [
                        {
                            "code": "schema_failure",
                            "meta": {
                                "field": "value",
                                "type": "invalid_type",
                                "message": "Expected string, received object",
                            },
                        }
                    ],
                },
            )

        with pytest.raises(ValueError) as raised:
            CacheFacade(FakeRestClient(handler)).set("ACME_SESSION", "whatever")

        assert str(raised.value) == (
            "The agent cache refused the call: 400 "
            "(validation_error: value: Expected string, received object)"
        )
        assert "whatever" not in str(raised.value)

    # @scenario "A refusal read from the REST envelope names the field too"
    def test_a_refusal_under_error_meta_names_the_rejected_field(self):
        # The body the production route answers, field for field.
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "type": "bad_request",
                        "code": "validation_error",
                        "message": "The request body didn't match the expected shape.",
                        "meta": {
                            "target": "json",
                            "fields": ["ttl_seconds"],
                            "reasons": [
                                {
                                    "code": "schema_failure",
                                    "message": "ttl_seconds must be at least 5",
                                    "meta": {
                                        "field": "ttl_seconds",
                                        "type": "too_small",
                                        "message": "ttl_seconds must be at least 5",
                                    },
                                }
                            ],
                        },
                        "trace_id": "15ed8c22c5c1ce30fd38065a07a80a7e",
                    }
                },
            )

        with pytest.raises(ValueError) as raised:
            CacheFacade(FakeRestClient(handler)).set(
                "ACME_SESSION", "whatever", ttl_seconds=1
            )

        assert str(raised.value) == (
            "The agent cache refused the call: 400 "
            "(validation_error: ttl_seconds: ttl_seconds must be at least 5)"
        )
        assert "whatever" not in str(raised.value)
