"""
API facade for teams, the grouping that projects and members belong to.

``/api/teams`` is an organization-class route: an organization API key
(``sk-lw-...``) authorizes it and there is no project to scope to, which is
why this facade sends no project header. Uses httpx via the generated REST
API client for HTTP transport.
"""

from typing import Any, Dict, Iterator, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import raise_for_status, walk_numbered_pages
from langwatch.utils.initialization import ensure_setup

TEAMS_PATH = "/api/teams"


class TeamsFacade:
    """Facade for the organization's teams."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "TeamsFacade":
        """Build the facade on the process-wide LangWatch client, setting it
        up first if nothing has yet."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def create(self, name: str) -> Dict[str, Any]:
        """Create a team, returning it with the slug the platform derived
        from the name."""
        response = self._http().post(TEAMS_PATH, json={"name": name})
        raise_for_status(response, operation="create team")
        return response.json()

    def list_page(
        self, *, page: Optional[int] = None, limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """One page of teams, as ``{data, pagination}``. Pages are numbered
        from one, and the server serves fifty per page unless told
        otherwise."""
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if limit is not None:
            params["limit"] = limit
        response = self._http().get(TEAMS_PATH, params=params)
        raise_for_status(response, operation="list teams")
        return response.json()

    def list(self, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Every team in the organization, following the pagination to
        exhaustion.

        Reading a single page would silently truncate any organization
        holding more teams than the server's page size."""
        return list(self.iterate(limit=limit))

    def iterate(self, *, limit: Optional[int] = None) -> Iterator[Dict[str, Any]]:
        """Every team, one row at a time, fetching a page only when the
        previous one runs out."""
        for page in walk_numbered_pages(
            lambda page_number: self.list_page(page=page_number, limit=limit)
        ):
            yield from page["data"]
