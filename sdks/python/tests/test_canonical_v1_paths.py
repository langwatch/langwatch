"""The canonical-generation guard for every request path the Python SDK builds.

Spec: specs/python-sdk/canonical-v1-request-paths.feature
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx

from langwatch.dashboards import DashboardsFacade

SDK_SRC = Path(__file__).resolve().parents[1] / "src" / "langwatch"
GENERATED = SDK_SRC / "generated"

# The families the served surface answers for at `/api/v1` as well as bare
# (packages/api/adrs/002 section 1). Everything else keeps its bare address.
V1_FAMILIES = frozenset(
    """agent-cache analytics annotations api-keys bug-reports coding-agent dashboards dataset
    dspy evaluations evaluators events experiment experiments governance graphs groups guardrails
    langy me model-defaults model-providers monitors optimization organization organizations
    playground prompts role-bindings roles scenario-events scenarios scim-tokens
    simulation-runs suites teams trace traces trigger triggers workflows""".split()
)

VERSION_SEGMENT = re.compile(r"^v\d+$")
BARE_PATH = re.compile(r"/api/([a-zA-Z0-9_-]+)((?:/[a-zA-Z0-9_{}-]+)*)")

# Routes the document keeps bare because they have no `/api/v1` twin.
BARE_ONLY = (re.compile(r"^/api/traces/[^/]+/transcript$"),)


def bare_family_paths(files: List[Path]) -> List[str]:
    offenders: List[str] = []
    for file in files:
        source = file.read_text()
        for match in BARE_PATH.finditer(source):
            if match.group(1) not in V1_FAMILIES:
                continue
            # A path already naming a generation of its own — `/api/evaluations/v3`
            # — is mounted once and keeps the address it has.
            tail = [part for part in match.group(2).split("/") if part]
            if any(VERSION_SEGMENT.match(part) for part in tail):
                continue
            if any(bare.match(match.group(0)) for bare in BARE_ONLY):
                continue
            line = source.count("\n", 0, match.start()) + 1
            offenders.append(f"{file.name}:{line} {match.group(0)}")
    return offenders


class FakeRestClient:
    """The one method the facades use from the generated client."""

    def __init__(self, calls: List[Tuple[str, str]]) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            calls.append((request.method, request.url.path))
            return httpx.Response(200, json={"dashboards": []})

        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


# @scenario "Hand-written facade request paths are v1-form"
def test_facade_request_paths_address_no_bare_family() -> None:
    files = [path for path in SDK_SRC.rglob("*.py") if GENERATED not in path.parents]
    # A guard that reads no files would pass while proving nothing.
    assert len(files) > 50

    assert bare_family_paths(files) == []


# @scenario "The generated REST client is v1-form"
def test_generated_client_request_urls_are_v1_form() -> None:
    urls = [
        match.group(1)
        for path in GENERATED.rglob("*.py")
        for match in re.finditer(r'"url": "(/api/[^"]*)"', path.read_text())
    ]
    assert len(urls) > 100

    published = set(urls)
    # A URL the document also publishes under `/api/v1` is the same logical
    # route at two addresses; the offence is a family that has no twin at all.
    bare = [
        url
        for url in urls
        if url.split("/")[2] in V1_FAMILIES
        and "/api/v1" + url[len("/api") :] not in published
        and not any(exempt.match(url) for exempt in BARE_ONLY)
    ]
    assert bare == []


# @scenario "A dashboard read goes out at the canonical address"
def test_dashboard_list_requests_the_canonical_address() -> None:
    calls: List[Tuple[str, str]] = []
    facade = DashboardsFacade(FakeRestClient(calls))  # type: ignore[arg-type]

    result: Dict[str, Any] = facade.list()

    assert result == {"dashboards": []}
    assert calls == [("GET", "/api/v1/dashboards")]
