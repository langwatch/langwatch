from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_projects_by_project_id_analytics_boards_by_dashboard_id_response_200 import (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200,
)
from ...models.get_api_v1_projects_by_project_id_analytics_boards_by_dashboard_id_response_400 import (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400,
)
from ...models.get_api_v1_projects_by_project_id_analytics_boards_by_dashboard_id_response_401 import (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401,
)
from ...models.get_api_v1_projects_by_project_id_analytics_boards_by_dashboard_id_response_403 import (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403,
)
from ...models.get_api_v1_projects_by_project_id_analytics_boards_by_dashboard_id_response_404 import (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404,
)
from ...models.get_api_v1_projects_by_project_id_analytics_boards_by_dashboard_id_response_500 import (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    dashboard_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/projects/{project_id}/analytics/boards/{dashboard_id}".format(
            project_id=quote(str(project_id), safe=""),
            dashboard_id=quote(str(dashboard_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
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
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
]:
    """Get a dashboard

     Returns one dashboard of the Dashboards area. A dashboard saved in another project, or one only
    Analytics Reports holds, is reported as not found. Use
    /api/v1/projects/{projectId}/analytics/dashboards; /analytics/boards is deprecated.

    Args:
        project_id (str):
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        dashboard_id=dashboard_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
    | None
):
    """Get a dashboard

     Returns one dashboard of the Dashboards area. A dashboard saved in another project, or one only
    Analytics Reports holds, is reported as not found. Use
    /api/v1/projects/{projectId}/analytics/dashboards; /analytics/boards is deprecated.

    Args:
        project_id (str):
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
    """

    return sync_detailed(
        project_id=project_id,
        dashboard_id=dashboard_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
]:
    """Get a dashboard

     Returns one dashboard of the Dashboards area. A dashboard saved in another project, or one only
    Analytics Reports holds, is reported as not found. Use
    /api/v1/projects/{projectId}/analytics/dashboards; /analytics/boards is deprecated.

    Args:
        project_id (str):
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        dashboard_id=dashboard_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404
    | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
    | None
):
    """Get a dashboard

     Returns one dashboard of the Dashboards area. A dashboard saved in another project, or one only
    Analytics Reports holds, is reported as not found. Use
    /api/v1/projects/{projectId}/analytics/dashboards; /analytics/boards is deprecated.

    Args:
        project_id (str):
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse200 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse400 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse401 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse403 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse404 | GetApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardIdResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            dashboard_id=dashboard_id,
            client=client,
        )
    ).parsed
