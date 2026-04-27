from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_graphs_response_200_item import GetApiGraphsResponse200Item
from ...models.get_api_graphs_response_400 import GetApiGraphsResponse400
from ...models.get_api_graphs_response_401 import GetApiGraphsResponse401
from ...models.get_api_graphs_response_422 import GetApiGraphsResponse422
from ...models.get_api_graphs_response_500 import GetApiGraphsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    dashboard_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["dashboardId"] = dashboard_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/graphs",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGraphsResponse400
    | GetApiGraphsResponse401
    | GetApiGraphsResponse422
    | GetApiGraphsResponse500
    | list[GetApiGraphsResponse200Item]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiGraphsResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGraphsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGraphsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiGraphsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGraphsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGraphsResponse400
    | GetApiGraphsResponse401
    | GetApiGraphsResponse422
    | GetApiGraphsResponse500
    | list[GetApiGraphsResponse200Item]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    dashboard_id: str | Unset = UNSET,
) -> Response[
    GetApiGraphsResponse400
    | GetApiGraphsResponse401
    | GetApiGraphsResponse422
    | GetApiGraphsResponse500
    | list[GetApiGraphsResponse200Item]
]:
    """List all custom graphs, optionally filtered by dashboard

    Args:
        dashboard_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGraphsResponse400 | GetApiGraphsResponse401 | GetApiGraphsResponse422 | GetApiGraphsResponse500 | list[GetApiGraphsResponse200Item]]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    dashboard_id: str | Unset = UNSET,
) -> (
    GetApiGraphsResponse400
    | GetApiGraphsResponse401
    | GetApiGraphsResponse422
    | GetApiGraphsResponse500
    | list[GetApiGraphsResponse200Item]
    | None
):
    """List all custom graphs, optionally filtered by dashboard

    Args:
        dashboard_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGraphsResponse400 | GetApiGraphsResponse401 | GetApiGraphsResponse422 | GetApiGraphsResponse500 | list[GetApiGraphsResponse200Item]
    """

    return sync_detailed(
        client=client,
        dashboard_id=dashboard_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    dashboard_id: str | Unset = UNSET,
) -> Response[
    GetApiGraphsResponse400
    | GetApiGraphsResponse401
    | GetApiGraphsResponse422
    | GetApiGraphsResponse500
    | list[GetApiGraphsResponse200Item]
]:
    """List all custom graphs, optionally filtered by dashboard

    Args:
        dashboard_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGraphsResponse400 | GetApiGraphsResponse401 | GetApiGraphsResponse422 | GetApiGraphsResponse500 | list[GetApiGraphsResponse200Item]]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    dashboard_id: str | Unset = UNSET,
) -> (
    GetApiGraphsResponse400
    | GetApiGraphsResponse401
    | GetApiGraphsResponse422
    | GetApiGraphsResponse500
    | list[GetApiGraphsResponse200Item]
    | None
):
    """List all custom graphs, optionally filtered by dashboard

    Args:
        dashboard_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGraphsResponse400 | GetApiGraphsResponse401 | GetApiGraphsResponse422 | GetApiGraphsResponse500 | list[GetApiGraphsResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
            dashboard_id=dashboard_id,
        )
    ).parsed
