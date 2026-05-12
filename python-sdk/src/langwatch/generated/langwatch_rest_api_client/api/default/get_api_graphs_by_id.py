from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_graphs_by_id_response_200 import GetApiGraphsByIdResponse200
from ...models.get_api_graphs_by_id_response_400 import GetApiGraphsByIdResponse400
from ...models.get_api_graphs_by_id_response_401 import GetApiGraphsByIdResponse401
from ...models.get_api_graphs_by_id_response_404 import GetApiGraphsByIdResponse404
from ...models.get_api_graphs_by_id_response_422 import GetApiGraphsByIdResponse422
from ...models.get_api_graphs_by_id_response_500 import GetApiGraphsByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/graphs/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGraphsByIdResponse200
    | GetApiGraphsByIdResponse400
    | GetApiGraphsByIdResponse401
    | GetApiGraphsByIdResponse404
    | GetApiGraphsByIdResponse422
    | GetApiGraphsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGraphsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGraphsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGraphsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiGraphsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiGraphsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGraphsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGraphsByIdResponse200
    | GetApiGraphsByIdResponse400
    | GetApiGraphsByIdResponse401
    | GetApiGraphsByIdResponse404
    | GetApiGraphsByIdResponse422
    | GetApiGraphsByIdResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiGraphsByIdResponse200
    | GetApiGraphsByIdResponse400
    | GetApiGraphsByIdResponse401
    | GetApiGraphsByIdResponse404
    | GetApiGraphsByIdResponse422
    | GetApiGraphsByIdResponse500
]:
    """Get a custom graph by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGraphsByIdResponse200 | GetApiGraphsByIdResponse400 | GetApiGraphsByIdResponse401 | GetApiGraphsByIdResponse404 | GetApiGraphsByIdResponse422 | GetApiGraphsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiGraphsByIdResponse200
    | GetApiGraphsByIdResponse400
    | GetApiGraphsByIdResponse401
    | GetApiGraphsByIdResponse404
    | GetApiGraphsByIdResponse422
    | GetApiGraphsByIdResponse500
    | None
):
    """Get a custom graph by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGraphsByIdResponse200 | GetApiGraphsByIdResponse400 | GetApiGraphsByIdResponse401 | GetApiGraphsByIdResponse404 | GetApiGraphsByIdResponse422 | GetApiGraphsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiGraphsByIdResponse200
    | GetApiGraphsByIdResponse400
    | GetApiGraphsByIdResponse401
    | GetApiGraphsByIdResponse404
    | GetApiGraphsByIdResponse422
    | GetApiGraphsByIdResponse500
]:
    """Get a custom graph by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGraphsByIdResponse200 | GetApiGraphsByIdResponse400 | GetApiGraphsByIdResponse401 | GetApiGraphsByIdResponse404 | GetApiGraphsByIdResponse422 | GetApiGraphsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiGraphsByIdResponse200
    | GetApiGraphsByIdResponse400
    | GetApiGraphsByIdResponse401
    | GetApiGraphsByIdResponse404
    | GetApiGraphsByIdResponse422
    | GetApiGraphsByIdResponse500
    | None
):
    """Get a custom graph by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGraphsByIdResponse200 | GetApiGraphsByIdResponse400 | GetApiGraphsByIdResponse401 | GetApiGraphsByIdResponse404 | GetApiGraphsByIdResponse422 | GetApiGraphsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
