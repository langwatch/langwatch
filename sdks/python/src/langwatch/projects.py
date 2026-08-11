"""
API facade for projects, the tenant everything else is written under.

``/api/projects`` is an organization-class route: an organization API key
(``sk-lw-...``) authorizes it and the project is named in the path or the
body, which is why this facade sends no project header. Uses httpx via the
generated REST API client for HTTP transport.
"""

from typing import Any, Dict, Iterator, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import (
    quote_path_segment,
    raise_for_status,
    walk_numbered_pages,
)
from langwatch.utils.initialization import ensure_setup

PROJECTS_PATH = "/api/projects"


class ProjectsFacade:
    """Facade for the organization's projects."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "ProjectsFacade":
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

    def create(
        self,
        *,
        name: str,
        language: str,
        framework: str,
        team_id: Optional[str] = None,
        new_team_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a project, returning it together with its own service API
        key under ``serviceApiKey``.

        That key is minted with the project and served ONCE, in this
        response: it is the credential the new project sends its traces
        with, and nothing serves it again.

        The project has to land in a team, so pass either ``team_id`` for an
        existing one or ``new_team_name`` to have a team created alongside
        it. ``language`` and ``framework`` describe the integration, such as
        python and langchain."""
        body: Dict[str, Any] = {
            "name": name,
            "language": language,
            "framework": framework,
        }
        if team_id is not None:
            body["teamId"] = team_id
        if new_team_name is not None:
            body["newTeamName"] = new_team_name
        response = self._http().post(PROJECTS_PATH, json=body)
        raise_for_status(response, operation="create project")
        return response.json()

    def list_page(
        self, *, page: Optional[int] = None, limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """One page of projects, as ``{data, pagination}``. Pages are
        numbered from one, and the server serves fifty per page unless told
        otherwise."""
        params: Dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if limit is not None:
            params["limit"] = limit
        response = self._http().get(PROJECTS_PATH, params=params)
        raise_for_status(response, operation="list projects")
        return response.json()

    def list(self, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Every project in the organization, following the pagination to
        exhaustion.

        Reading a single page would silently truncate any organization
        holding more projects than the server's page size."""
        return list(self.iterate(limit=limit))

    def iterate(self, *, limit: Optional[int] = None) -> Iterator[Dict[str, Any]]:
        """Every project, one row at a time, fetching a page only when the
        previous one runs out."""
        for page in walk_numbered_pages(
            lambda page_number: self.list_page(page=page_number, limit=limit)
        ):
            yield from page["data"]

    def archive(self, project_id: str) -> Dict[str, Any]:
        """Archive a project, returning it with the time it was archived.

        The project stops accepting traffic and drops out of listings; the
        data it already holds is left alone."""
        response = self._http().delete(
            f"{PROJECTS_PATH}/{quote_path_segment(project_id)}"
        )
        raise_for_status(response, operation="archive project")
        return response.json()
