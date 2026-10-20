from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_projects_by_project_id_analytics_boards_body import (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsBody,
)
from ...models.post_api_v1_projects_by_project_id_analytics_boards_response_201 import (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201,
)
from ...models.post_api_v1_projects_by_project_id_analytics_boards_response_400 import (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400,
)
from ...models.post_api_v1_projects_by_project_id_analytics_boards_response_401 import (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401,
)
from ...models.post_api_v1_projects_by_project_id_analytics_boards_response_403 import (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403,
)
from ...models.post_api_v1_projects_by_project_id_analytics_boards_response_500 import (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    *,
    body: PostApiV1ProjectsByProjectIdAnalyticsBoardsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/projects/{project_id}/analytics/boards".format(
            project_id=quote(str(project_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
]:
    # LangWatch override: use safe_http_status to tolerate non-IANA status codes
    # (Cloudflare 520-527, AWS WAF 561, etc). Upstream still crashes here.
    # Tracked upstream: https://github.com/openapi-generators/openapi-python-client/pull/1407
    return Response(
        status_code=safe_http_status(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsBoardsBody,
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
]:
    """Create a Dashboards board

     Creates an empty board in the Dashboards area. Pass its id to the dashboard widget's add-to-
    dashboard endpoint to place a widget on it. A board made by POST /api/dashboards belongs to
    Analytics Reports and cannot hold dashboard widgets.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsBoardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsBoardsBody,
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
    | None
):
    """Create a Dashboards board

     Creates an empty board in the Dashboards area. Pass its id to the dashboard widget's add-to-
    dashboard endpoint to place a widget on it. A board made by POST /api/dashboards belongs to
    Analytics Reports and cannot hold dashboard widgets.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsBoardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
    """

    return sync_detailed(
        project_id=project_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsBoardsBody,
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
]:
    """Create a Dashboards board

     Creates an empty board in the Dashboards area. Pass its id to the dashboard widget's add-to-
    dashboard endpoint to place a widget on it. A board made by POST /api/dashboards belongs to
    Analytics Reports and cannot hold dashboard widgets.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsBoardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsBoardsBody,
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
    | None
):
    """Create a Dashboards board

     Creates an empty board in the Dashboards area. Pass its id to the dashboard widget's add-to-
    dashboard endpoint to place a widget on it. A board made by POST /api/dashboards belongs to
    Analytics Reports and cannot hold dashboard widgets.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsBoardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsBoardsResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            client=client,
            body=body,
        )
    ).parsed
