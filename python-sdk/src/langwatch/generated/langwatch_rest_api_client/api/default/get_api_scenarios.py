from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_scenarios_response_200_item import GetApiScenariosResponse200Item
from ...models.get_api_scenarios_response_400 import GetApiScenariosResponse400
from ...models.get_api_scenarios_response_401 import GetApiScenariosResponse401
from ...models.get_api_scenarios_response_422 import GetApiScenariosResponse422
from ...models.get_api_scenarios_response_500 import GetApiScenariosResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/scenarios",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiScenariosResponse400
    | GetApiScenariosResponse401
    | GetApiScenariosResponse422
    | GetApiScenariosResponse500
    | list[GetApiScenariosResponse200Item]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiScenariosResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = GetApiScenariosResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiScenariosResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiScenariosResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiScenariosResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiScenariosResponse400
    | GetApiScenariosResponse401
    | GetApiScenariosResponse422
    | GetApiScenariosResponse500
    | list[GetApiScenariosResponse200Item]
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
    GetApiScenariosResponse400
    | GetApiScenariosResponse401
    | GetApiScenariosResponse422
    | GetApiScenariosResponse500
    | list[GetApiScenariosResponse200Item]
]:
    """Get all scenarios for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiScenariosResponse400 | GetApiScenariosResponse401 | GetApiScenariosResponse422 | GetApiScenariosResponse500 | list[GetApiScenariosResponse200Item]]
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
    GetApiScenariosResponse400
    | GetApiScenariosResponse401
    | GetApiScenariosResponse422
    | GetApiScenariosResponse500
    | list[GetApiScenariosResponse200Item]
    | None
):
    """Get all scenarios for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiScenariosResponse400 | GetApiScenariosResponse401 | GetApiScenariosResponse422 | GetApiScenariosResponse500 | list[GetApiScenariosResponse200Item]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiScenariosResponse400
    | GetApiScenariosResponse401
    | GetApiScenariosResponse422
    | GetApiScenariosResponse500
    | list[GetApiScenariosResponse200Item]
]:
    """Get all scenarios for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiScenariosResponse400 | GetApiScenariosResponse401 | GetApiScenariosResponse422 | GetApiScenariosResponse500 | list[GetApiScenariosResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiScenariosResponse400
    | GetApiScenariosResponse401
    | GetApiScenariosResponse422
    | GetApiScenariosResponse500
    | list[GetApiScenariosResponse200Item]
    | None
):
    """Get all scenarios for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiScenariosResponse400 | GetApiScenariosResponse401 | GetApiScenariosResponse422 | GetApiScenariosResponse500 | list[GetApiScenariosResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
