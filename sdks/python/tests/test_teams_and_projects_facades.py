"""Unit coverage for the teams and projects facades: every method hits its
route with the right verb and shape, hands back the body the REST app
actually serves (including the service API key a create mints), and follows
numbered pagination past the first page. Transport is a mounted
httpx.MockTransport; no network, no generated-client coupling beyond
get_httpx_client().

Spec: specs/teams/sdk-teams-and-projects.feature
"""

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

import langwatch
import langwatch.projects as projects_module
import langwatch.teams as teams_module
from langwatch.api_errors import LangWatchApiNotFoundError
from langwatch.projects import ProjectsFacade
from langwatch.teams import TeamsFacade


class FakeRestClient:
    """The one method the facades use from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def recorder(responses: Dict[Tuple[str, str], Any], status: int = 200):
    calls: List[Tuple[str, str, Optional[Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        body = None
        if request.content:
            body = json.loads(request.content)
        calls.append((request.method, str(request.url), body))
        payload = responses.get(key)
        assert payload is not None, f"unexpected call {key}"
        return httpx.Response(status, json=payload)

    return handler, calls


def numbered(pages: List[Dict[str, Any]]):
    """A handler serving the given pages in order, recording page numbers."""
    seen_pages: List[Optional[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_pages.append(request.url.params.get("page"))
        return httpx.Response(200, json=pages[len(seen_pages) - 1])

    return handler, seen_pages


# @scenario "Teams and projects are reachable from the SDK entry point"
def test_teams_and_projects_resolve_from_the_package_entry_point(monkeypatch):
    # The package resolves a facade the first time its name is read and caches
    # the result, so a wrong module path or class name in the registry only
    # fails when a caller reaches for it. Reading both names here is what
    # holds that wiring.
    instance = SimpleNamespace(
        rest_api_client=FakeRestClient(lambda _: httpx.Response(200, json={}))
    )
    for module in (teams_module, projects_module):
        monkeypatch.setattr(module, "ensure_setup", lambda: None)
        monkeypatch.setattr(module, "get_instance", lambda: instance)
    for name in ("teams", "projects"):
        monkeypatch.delitem(vars(langwatch), name, raising=False)

    assert isinstance(langwatch.teams, TeamsFacade)
    assert isinstance(langwatch.projects, ProjectsFacade)
    assert "teams" in langwatch.__all__
    assert "projects" in langwatch.__all__


# @scenario "Creating a team from the SDK returns the team with its slug"
def test_teams_create_and_list_routes():
    handler, calls = recorder(
        {
            ("POST", "/api/teams"): {
                "id": "team_1",
                "name": "ACME Platform",
                "slug": "acme-platform",
                "organizationId": "org_1",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
            },
            ("GET", "/api/teams"): {
                "data": [{"id": "team_1", "name": "ACME Platform"}],
                "pagination": {"page": 1, "limit": 50, "total": 1},
            },
        }
    )
    facade = TeamsFacade(FakeRestClient(handler))

    created = facade.create("ACME Platform")
    assert created["id"] == "team_1"
    assert created["slug"] == "acme-platform"
    create_call = next(c for c in calls if c[0] == "POST")
    assert create_call[2] == {"name": "ACME Platform"}

    rows = facade.list()
    assert [row["id"] for row in rows] == ["team_1"]


# @scenario "Listing teams from the SDK follows pagination past the first page"
def test_teams_list_walks_every_page():
    handler, seen_pages = numbered(
        [
            {
                "data": [{"id": "team_1"}, {"id": "team_2"}],
                "pagination": {"page": 1, "limit": 2, "total": 3},
            },
            {
                "data": [{"id": "team_3"}],
                "pagination": {"page": 2, "limit": 2, "total": 3},
            },
        ]
    )
    facade = TeamsFacade(FakeRestClient(handler))

    rows = facade.list(limit=2)

    assert [row["id"] for row in rows] == ["team_1", "team_2", "team_3"]
    assert seen_pages == ["1", "2"]


def test_list_rejects_a_page_whose_data_is_not_a_list():
    # Named at the walk rather than left to surface from inside the caller's
    # loop, where reading the rows off the page fails as a bare KeyError or
    # TypeError with nothing pointing at the malformed answer.
    handler, _ = numbered([{"pagination": {"page": 1, "limit": 50, "total": 1}}])
    facade = TeamsFacade(FakeRestClient(handler))

    with pytest.raises(RuntimeError, match="rather than a list of rows"):
        facade.list()


# @scenario "Creating a project from the SDK returns the service API key minted with it"
def test_projects_create_serves_the_service_api_key():
    handler, calls = recorder(
        {
            ("POST", "/api/projects"): {
                "id": "proj_1",
                "name": "ACME Tenant",
                "slug": "acme-tenant",
                "language": "python",
                "framework": "openai",
                "teamId": "team_1",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
                "serviceApiKey": "sk-lw-minted-once",
                "serviceApiKeyId": "key_1",
            }
        },
        status=201,
    )
    facade = ProjectsFacade(FakeRestClient(handler))

    created = facade.create(
        name="ACME Tenant",
        language="python",
        framework="openai",
        team_id="team_1",
    )

    # The key is minted with the project and served exactly once, here.
    assert created["serviceApiKey"] == "sk-lw-minted-once"
    assert created["serviceApiKeyId"] == "key_1"
    assert created["id"] == "proj_1"
    assert calls[0][2] == {
        "name": "ACME Tenant",
        "language": "python",
        "framework": "openai",
        "teamId": "team_1",
    }


# @scenario "Creating a project from the SDK can open its team at the same time"
def test_projects_create_can_open_a_team_alongside_the_project():
    handler, calls = recorder(
        {("POST", "/api/projects"): {"id": "proj_2", "teamId": "team_new"}},
        status=201,
    )
    facade = ProjectsFacade(FakeRestClient(handler))

    facade.create(
        name="ACME Tenant",
        language="typescript",
        framework="langchain",
        new_team_name="ACME",
    )

    assert calls[0][2] == {
        "name": "ACME Tenant",
        "language": "typescript",
        "framework": "langchain",
        "newTeamName": "ACME",
    }


# @scenario "Archiving a project from the SDK reports when it was archived"
def test_projects_list_and_archive_routes():
    handler, calls = recorder(
        {
            ("GET", "/api/projects"): {
                "data": [{"id": "proj_1"}],
                "pagination": {"page": 1, "limit": 50, "total": 1},
            },
            ("DELETE", "/api/projects/proj_1"): {
                "id": "proj_1",
                "name": "ACME Tenant",
                "archivedAt": "2026-02-01T00:00:00Z",
            },
        }
    )
    facade = ProjectsFacade(FakeRestClient(handler))

    assert [row["id"] for row in facade.list()] == ["proj_1"]

    archived = facade.archive("proj_1")
    assert archived["archivedAt"] == "2026-02-01T00:00:00Z"
    assert any(call[0] == "DELETE" for call in calls)


def test_projects_archive_quotes_the_project_id():
    # raw_path rather than path: httpx decodes the latter, which would hide a
    # separator that escaped into the URL as its own path segment.
    calls: List[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.raw_path)
        return httpx.Response(200, json={"id": "weird/id"})

    facade = ProjectsFacade(FakeRestClient(handler))
    facade.archive("weird/id")

    assert calls == [b"/api/projects/weird%2Fid"]


# @scenario "A refused project call raises the typed error for its status"
def test_projects_refusal_raises_the_typed_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Not Found", "message": "gone"})

    facade = ProjectsFacade(FakeRestClient(handler))

    with pytest.raises(LangWatchApiNotFoundError):
        facade.archive("proj_missing")
