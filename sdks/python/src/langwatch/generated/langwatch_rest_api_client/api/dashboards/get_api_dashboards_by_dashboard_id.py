from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_dashboards_by_dashboard_id_response_200 import GetApiDashboardsByDashboardIdResponse200
from ...models.get_api_dashboards_by_dashboard_id_response_400 import GetApiDashboardsByDashboardIdResponse400
from ...models.get_api_dashboards_by_dashboard_id_response_401 import GetApiDashboardsByDashboardIdResponse401
from ...models.get_api_dashboards_by_dashboard_id_response_403 import GetApiDashboardsByDashboardIdResponse403
from ...models.get_api_dashboards_by_dashboard_id_response_404 import GetApiDashboardsByDashboardIdResponse404
from ...models.get_api_dashboards_by_dashboard_id_response_500 import GetApiDashboardsByDashboardIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    dashboard_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/dashboards/{dashboard_id}".format(
            dashboard_id=quote(str(dashboard_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiDashboardsByDashboardIdResponse200
    | GetApiDashboardsByDashboardIdResponse400
    | GetApiDashboardsByDashboardIdResponse401
    | GetApiDashboardsByDashboardIdResponse403
    | GetApiDashboardsByDashboardIdResponse404
    | GetApiDashboardsByDashboardIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiDashboardsByDashboardIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiDashboardsByDashboardIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiDashboardsByDashboardIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiDashboardsByDashboardIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiDashboardsByDashboardIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetApiDashboardsByDashboardIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiDashboardsByDashboardIdResponse200
    | GetApiDashboardsByDashboardIdResponse400
    | GetApiDashboardsByDashboardIdResponse401
    | GetApiDashboardsByDashboardIdResponse403
    | GetApiDashboardsByDashboardIdResponse404
    | GetApiDashboardsByDashboardIdResponse500
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
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiDashboardsByDashboardIdResponse200
    | GetApiDashboardsByDashboardIdResponse400
    | GetApiDashboardsByDashboardIdResponse401
    | GetApiDashboardsByDashboardIdResponse403
    | GetApiDashboardsByDashboardIdResponse404
    | GetApiDashboardsByDashboardIdResponse500
]:
    """Get a board

     Returns one Dashboards board.

    Args:
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiDashboardsByDashboardIdResponse200 | GetApiDashboardsByDashboardIdResponse400 | GetApiDashboardsByDashboardIdResponse401 | GetApiDashboardsByDashboardIdResponse403 | GetApiDashboardsByDashboardIdResponse404 | GetApiDashboardsByDashboardIdResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiDashboardsByDashboardIdResponse200
    | GetApiDashboardsByDashboardIdResponse400
    | GetApiDashboardsByDashboardIdResponse401
    | GetApiDashboardsByDashboardIdResponse403
    | GetApiDashboardsByDashboardIdResponse404
    | GetApiDashboardsByDashboardIdResponse500
    | None
):
    """Get a board

     Returns one Dashboards board.

    Args:
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiDashboardsByDashboardIdResponse200 | GetApiDashboardsByDashboardIdResponse400 | GetApiDashboardsByDashboardIdResponse401 | GetApiDashboardsByDashboardIdResponse403 | GetApiDashboardsByDashboardIdResponse404 | GetApiDashboardsByDashboardIdResponse500
    """

    return sync_detailed(
        dashboard_id=dashboard_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiDashboardsByDashboardIdResponse200
    | GetApiDashboardsByDashboardIdResponse400
    | GetApiDashboardsByDashboardIdResponse401
    | GetApiDashboardsByDashboardIdResponse403
    | GetApiDashboardsByDashboardIdResponse404
    | GetApiDashboardsByDashboardIdResponse500
]:
    """Get a board

     Returns one Dashboards board.

    Args:
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiDashboardsByDashboardIdResponse200 | GetApiDashboardsByDashboardIdResponse400 | GetApiDashboardsByDashboardIdResponse401 | GetApiDashboardsByDashboardIdResponse403 | GetApiDashboardsByDashboardIdResponse404 | GetApiDashboardsByDashboardIdResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiDashboardsByDashboardIdResponse200
    | GetApiDashboardsByDashboardIdResponse400
    | GetApiDashboardsByDashboardIdResponse401
    | GetApiDashboardsByDashboardIdResponse403
    | GetApiDashboardsByDashboardIdResponse404
    | GetApiDashboardsByDashboardIdResponse500
    | None
):
    """Get a board

     Returns one Dashboards board.

    Args:
        dashboard_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiDashboardsByDashboardIdResponse200 | GetApiDashboardsByDashboardIdResponse400 | GetApiDashboardsByDashboardIdResponse401 | GetApiDashboardsByDashboardIdResponse403 | GetApiDashboardsByDashboardIdResponse404 | GetApiDashboardsByDashboardIdResponse500
    """

    return (
        await asyncio_detailed(
            dashboard_id=dashboard_id,
            client=client,
        )
    ).parsed
