from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_body import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody,
)
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_200 import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200,
)
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_400 import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400,
)
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_401 import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401,
)
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_403 import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403,
)
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_404 import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404,
)
from ...models.put_api_v1_projects_by_project_id_analytics_charts_by_chart_id_placement_response_500 import (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    chart_id: str,
    *,
    body: PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/projects/{project_id}/analytics/charts/{chart_id}/placement".format(
            project_id=quote(str(project_id), safe=""),
            chart_id=quote(str(chart_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 401:
        response_401 = PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401.from_dict(
            response.json()
        )

        return response_401

    if response.status_code == 403:
        response_403 = PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403.from_dict(
            response.json()
        )

        return response_403

    if response.status_code == 404:
        response_404 = PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404.from_dict(
            response.json()
        )

        return response_404

    if response.status_code == 500:
        response_500 = PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500.from_dict(
            response.json()
        )

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
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
    chart_id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody,
) -> Response[
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
]:
    """Place a saved workbench chart on a dashboard

     Places one saved LangWatchQL chart on a dashboard in the same project, at the grid position supplied
    — or, when no grid row is given, at the next row free on that dashboard, counting charts of every
    kind. A dashboard that is not in this project is reported as not found, exactly like a chart that is
    not, and nothing is written.

    Args:
        project_id (str):
        chart_id (str):
        body (PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        chart_id=chart_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    chart_id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody,
) -> (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
    | None
):
    """Place a saved workbench chart on a dashboard

     Places one saved LangWatchQL chart on a dashboard in the same project, at the grid position supplied
    — or, when no grid row is given, at the next row free on that dashboard, counting charts of every
    kind. A dashboard that is not in this project is reported as not found, exactly like a chart that is
    not, and nothing is written.

    Args:
        project_id (str):
        chart_id (str):
        body (PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
    """

    return sync_detailed(
        project_id=project_id,
        chart_id=chart_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    chart_id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody,
) -> Response[
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
]:
    """Place a saved workbench chart on a dashboard

     Places one saved LangWatchQL chart on a dashboard in the same project, at the grid position supplied
    — or, when no grid row is given, at the next row free on that dashboard, counting charts of every
    kind. A dashboard that is not in this project is reported as not found, exactly like a chart that is
    not, and nothing is written.

    Args:
        project_id (str):
        chart_id (str):
        body (PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        chart_id=chart_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    chart_id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody,
) -> (
    PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404
    | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
    | None
):
    """Place a saved workbench chart on a dashboard

     Places one saved LangWatchQL chart on a dashboard in the same project, at the grid position supplied
    — or, when no grid row is given, at the next row free on that dashboard, counting charts of every
    kind. A dashboard that is not in this project is reported as not found, exactly like a chart that is
    not, and nothing is written.

    Args:
        project_id (str):
        chart_id (str):
        body (PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse200 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse400 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse401 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse404 | PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            chart_id=chart_id,
            client=client,
            body=body,
        )
    ).parsed
