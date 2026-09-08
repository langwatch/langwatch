from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_400 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_401 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_403 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_404 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_charts_by_chart_id_response_500 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    chart_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/projects/{project_id}/analytics/charts/{chart_id}".format(
            project_id=quote(str(project_id), safe=""),
            chart_id=quote(str(chart_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    Any
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
    | None
):
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
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
) -> Response[
    Any
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
]:
    """Delete a saved workbench chart

     Deletes one saved LangWatchQL chart. Answers 204 with no body; deleting a chart that is not in this
    project is reported as not found.

    Args:
        project_id (str):
        chart_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        chart_id=chart_id,
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
) -> (
    Any
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
    | None
):
    """Delete a saved workbench chart

     Deletes one saved LangWatchQL chart. Answers 204 with no body; deleting a chart that is not in this
    project is reported as not found.

    Args:
        project_id (str):
        chart_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
    """

    return sync_detailed(
        project_id=project_id,
        chart_id=chart_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    chart_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    Any
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
]:
    """Delete a saved workbench chart

     Deletes one saved LangWatchQL chart. Answers 204 with no body; deleting a chart that is not in this
    project is reported as not found.

    Args:
        project_id (str):
        chart_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        chart_id=chart_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    chart_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    Any
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
    | None
):
    """Delete a saved workbench chart

     Deletes one saved LangWatchQL chart. Answers 204 with no body; deleting a chart that is not in this
    project is reported as not found.

    Args:
        project_id (str):
        chart_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            chart_id=chart_id,
            client=client,
        )
    ).parsed
