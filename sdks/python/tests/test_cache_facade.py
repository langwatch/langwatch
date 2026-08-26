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

        name = path.removeprefix("/api/agent-cache/")
        body: Dict[str, Any] = json.loads(request.content) if request.content else {}

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


class TestDelete:
    def test_removes_the_entry(self):
        stub = CacheStub(stored={"ACME_SESSION": "session-1"})

        facade_over(stub).delete("ACME_SESSION")

        assert stub.stored == {}
        assert ("DELETE", "/api/agent-cache/ACME_SESSION") in stub.calls


class TestMessages:
    # @scenario "No message from the SDK quotes a cached value"
    def test_no_message_quotes_the_value_the_caller_sent(self):
        stub = CacheStub()
        stub.refuse_with = 403

        with pytest.raises(RuntimeError) as raised:
            facade_over(stub).set("ACME_SESSION", "a-session-nobody-may-print")

        assert "a-session-nobody-may-print" not in str(raised.value)
