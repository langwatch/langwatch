from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_triggers_response_200_item import GetApiTriggersResponse200Item
from ...models.get_api_triggers_response_400 import GetApiTriggersResponse400
from ...models.get_api_triggers_response_401 import GetApiTriggersResponse401
from ...models.get_api_triggers_response_422 import GetApiTriggersResponse422
from ...models.get_api_triggers_response_500 import GetApiTriggersResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/triggers",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiTriggersResponse400
    | GetApiTriggersResponse401
    | GetApiTriggersResponse422
    | GetApiTriggersResponse500
    | list[GetApiTriggersResponse200Item]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiTriggersResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = GetApiTriggersResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiTriggersResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiTriggersResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiTriggersResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiTriggersResponse400
    | GetApiTriggersResponse401
    | GetApiTriggersResponse422
    | GetApiTriggersResponse500
    | list[GetApiTriggersResponse200Item]
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
) -> Response[
    GetApiTriggersResponse400
    | GetApiTriggersResponse401
    | GetApiTriggersResponse422
    | GetApiTriggersResponse500
    | list[GetApiTriggersResponse200Item]
]:
    """List all active triggers (automations) for the project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTriggersResponse400 | GetApiTriggersResponse401 | GetApiTriggersResponse422 | GetApiTriggersResponse500 | list[GetApiTriggersResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiTriggersResponse400
    | GetApiTriggersResponse401
    | GetApiTriggersResponse422
    | GetApiTriggersResponse500
    | list[GetApiTriggersResponse200Item]
    | None
):
    """List all active triggers (automations) for the project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTriggersResponse400 | GetApiTriggersResponse401 | GetApiTriggersResponse422 | GetApiTriggersResponse500 | list[GetApiTriggersResponse200Item]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiTriggersResponse400
    | GetApiTriggersResponse401
    | GetApiTriggersResponse422
    | GetApiTriggersResponse500
    | list[GetApiTriggersResponse200Item]
]:
    """List all active triggers (automations) for the project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTriggersResponse400 | GetApiTriggersResponse401 | GetApiTriggersResponse422 | GetApiTriggersResponse500 | list[GetApiTriggersResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiTriggersResponse400
    | GetApiTriggersResponse401
    | GetApiTriggersResponse422
    | GetApiTriggersResponse500
    | list[GetApiTriggersResponse200Item]
    | None
):
    """List all active triggers (automations) for the project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTriggersResponse400 | GetApiTriggersResponse401 | GetApiTriggersResponse422 | GetApiTriggersResponse500 | list[GetApiTriggersResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
