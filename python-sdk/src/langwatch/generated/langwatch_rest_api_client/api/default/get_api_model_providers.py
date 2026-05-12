from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_model_providers_response_200 import GetApiModelProvidersResponse200
from ...models.get_api_model_providers_response_400 import GetApiModelProvidersResponse400
from ...models.get_api_model_providers_response_401 import GetApiModelProvidersResponse401
from ...models.get_api_model_providers_response_422 import GetApiModelProvidersResponse422
from ...models.get_api_model_providers_response_500 import GetApiModelProvidersResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/model-providers",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiModelProvidersResponse200
    | GetApiModelProvidersResponse400
    | GetApiModelProvidersResponse401
    | GetApiModelProvidersResponse422
    | GetApiModelProvidersResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiModelProvidersResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiModelProvidersResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiModelProvidersResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiModelProvidersResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiModelProvidersResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiModelProvidersResponse200
    | GetApiModelProvidersResponse400
    | GetApiModelProvidersResponse401
    | GetApiModelProvidersResponse422
    | GetApiModelProvidersResponse500
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
    GetApiModelProvidersResponse200
    | GetApiModelProvidersResponse400
    | GetApiModelProvidersResponse401
    | GetApiModelProvidersResponse422
    | GetApiModelProvidersResponse500
]:
    """List all model providers for a project with masked API keys

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiModelProvidersResponse200 | GetApiModelProvidersResponse400 | GetApiModelProvidersResponse401 | GetApiModelProvidersResponse422 | GetApiModelProvidersResponse500]
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
    GetApiModelProvidersResponse200
    | GetApiModelProvidersResponse400
    | GetApiModelProvidersResponse401
    | GetApiModelProvidersResponse422
    | GetApiModelProvidersResponse500
    | None
):
    """List all model providers for a project with masked API keys

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiModelProvidersResponse200 | GetApiModelProvidersResponse400 | GetApiModelProvidersResponse401 | GetApiModelProvidersResponse422 | GetApiModelProvidersResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiModelProvidersResponse200
    | GetApiModelProvidersResponse400
    | GetApiModelProvidersResponse401
    | GetApiModelProvidersResponse422
    | GetApiModelProvidersResponse500
]:
    """List all model providers for a project with masked API keys

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiModelProvidersResponse200 | GetApiModelProvidersResponse400 | GetApiModelProvidersResponse401 | GetApiModelProvidersResponse422 | GetApiModelProvidersResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiModelProvidersResponse200
    | GetApiModelProvidersResponse400
    | GetApiModelProvidersResponse401
    | GetApiModelProvidersResponse422
    | GetApiModelProvidersResponse500
    | None
):
    """List all model providers for a project with masked API keys

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiModelProvidersResponse200 | GetApiModelProvidersResponse400 | GetApiModelProvidersResponse401 | GetApiModelProvidersResponse422 | GetApiModelProvidersResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
