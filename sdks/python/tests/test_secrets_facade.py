"""Unit coverage for the secrets facade upsert and value read.

Transport is a mounted httpx.MockTransport, so the tests assert on the calls
the facade makes rather than on a live API.

Spec: specs/secrets/secret-value-read.feature
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.secrets import SecretsFacade


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


class SecretsStub:
    """A project secret store that answers the routes the facade calls."""

    def __init__(self, *, stored: Optional[Dict[str, str]] = None) -> None:
        self.stored: Dict[str, str] = dict(stored or {})
        self.calls: List[Tuple[str, str]] = []
        # Set to a name to make the first create for it collide, the way a row
        # running beside this one would.
        self.claimed_on_create: Optional[str] = None

    def _id(self, name: str) -> str:
        return f"secret-{name}"

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))
        body: Dict[str, Any] = (
            json.loads(request.content) if request.content else {}
        )

        if request.method == "GET" and path == "/api/secrets":
            return httpx.Response(
                200,
                json=[
                    {"id": self._id(name), "name": name}
                    for name in sorted(self.stored)
                ],
            )

        if request.method == "POST" and path == "/api/secrets":
            name = body["name"]
            if self.claimed_on_create == name:
                self.claimed_on_create = None
                self.stored[name] = "written-by-the-other-row"
                return httpx.Response(
                    409, json={"error": "A secret with that name already exists"}
                )
            self.stored[name] = body["value"]
            return httpx.Response(201, json={"id": self._id(name), "name": name})

        if request.method == "PUT" and path.startswith("/api/secrets/"):
            secret_id = path.removeprefix("/api/secrets/")
            for name in self.stored:
                if self._id(name) == secret_id:
                    self.stored[name] = body["value"]
                    return httpx.Response(
                        200, json={"id": secret_id, "name": name}
                    )
            return httpx.Response(404, json={"error": "secret_not_found"})

        if request.method == "GET" and path.startswith("/api/secrets/by-name/"):
            name = path.removeprefix("/api/secrets/by-name/").removesuffix(
                "/value"
            )
            if name not in self.stored:
                return httpx.Response(404, json={"error": "secret_not_found"})
            return httpx.Response(
                200,
                json={
                    "name": name,
                    "value": self.stored[name],
                    "updatedAt": "2026-01-01T00:00:00.000Z",
                },
            )

        raise AssertionError(f"unexpected call {request.method} {path}")


def facade_over(stub: SecretsStub) -> SecretsFacade:
    return SecretsFacade(FakeRestClient(stub.handler))


class TestSet:
    # @scenario "Storing a secret that does not exist yet creates it"
    def test_creates_a_secret_the_project_does_not_hold(self):
        stub = SecretsStub()

        facade_over(stub).set("ACME_SESSION", "first")

        assert stub.stored == {"ACME_SESSION": "first"}
        assert ("POST", "/api/secrets") in stub.calls
        assert ("PUT", "/api/secrets/secret-ACME_SESSION") not in stub.calls

    # @scenario "Storing a secret that exists replaces its value"
    def test_updates_a_secret_the_project_already_holds(self):
        stub = SecretsStub(stored={"ACME_SESSION": "first"})

        facade_over(stub).set("ACME_SESSION", "second")

        assert stub.stored == {"ACME_SESSION": "second"}
        assert ("POST", "/api/secrets") not in stub.calls
        assert ("PUT", "/api/secrets/secret-ACME_SESSION") in stub.calls

    # @scenario "A secret created by a row running beside this one is updated instead"
    def test_updates_when_another_caller_creates_the_name_first(self):
        stub = SecretsStub()
        stub.claimed_on_create = "ACME_SESSION"

        facade_over(stub).set("ACME_SESSION", "mine")

        assert stub.stored == {"ACME_SESSION": "mine"}
        assert ("POST", "/api/secrets") in stub.calls
        assert ("PUT", "/api/secrets/secret-ACME_SESSION") in stub.calls


class TestGetValue:
    def test_reads_the_stored_value_back(self):
        stub = SecretsStub(stored={"ACME_SESSION": "session-1"})

        assert facade_over(stub).get_value("ACME_SESSION") == "session-1"
        assert (
            "GET",
            "/api/secrets/by-name/ACME_SESSION/value",
        ) in stub.calls

    # @scenario "Reading a value the project does not hold names the missing secret"
    def test_names_a_secret_the_project_does_not_hold(self):
        stub = SecretsStub()

        with pytest.raises(ValueError, match="not found"):
            facade_over(stub).get_value("ACME_SESSION")
