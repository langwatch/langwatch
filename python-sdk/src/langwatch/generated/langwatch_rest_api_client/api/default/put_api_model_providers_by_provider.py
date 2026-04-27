from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_model_providers_by_provider_body import PutApiModelProvidersByProviderBody
from ...models.put_api_model_providers_by_provider_response_200 import PutApiModelProvidersByProviderResponse200
from ...models.put_api_model_providers_by_provider_response_400 import PutApiModelProvidersByProviderResponse400
from ...models.put_api_model_providers_by_provider_response_401 import PutApiModelProvidersByProviderResponse401
from ...models.put_api_model_providers_by_provider_response_422 import PutApiModelProvidersByProviderResponse422
from ...models.put_api_model_providers_by_provider_response_500 import PutApiModelProvidersByProviderResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    provider: str,
    *,
    body: PutApiModelProvidersByProviderBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/model-providers/{provider}".format(
            provider=quote(str(provider), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PutApiModelProvidersByProviderResponse200
    | PutApiModelProvidersByProviderResponse400
    | PutApiModelProvidersByProviderResponse401
    | PutApiModelProvidersByProviderResponse422
    | PutApiModelProvidersByProviderResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiModelProvidersByProviderResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiModelProvidersByProviderResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiModelProvidersByProviderResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PutApiModelProvidersByProviderResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiModelProvidersByProviderResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiModelProvidersByProviderResponse200
    | PutApiModelProvidersByProviderResponse400
    | PutApiModelProvidersByProviderResponse401
    | PutApiModelProvidersByProviderResponse422
    | PutApiModelProvidersByProviderResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    provider: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelProvidersByProviderBody | Unset = UNSET,
) -> Response[
    PutApiModelProvidersByProviderResponse200
    | PutApiModelProvidersByProviderResponse400
    | PutApiModelProvidersByProviderResponse401
    | PutApiModelProvidersByProviderResponse422
    | PutApiModelProvidersByProviderResponse500
]:
    """Create or update a model provider

    Args:
        provider (str):
        body (PutApiModelProvidersByProviderBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiModelProvidersByProviderResponse200 | PutApiModelProvidersByProviderResponse400 | PutApiModelProvidersByProviderResponse401 | PutApiModelProvidersByProviderResponse422 | PutApiModelProvidersByProviderResponse500]
    """

    kwargs = _get_kwargs(
        provider=provider,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    provider: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelProvidersByProviderBody | Unset = UNSET,
) -> (
    PutApiModelProvidersByProviderResponse200
    | PutApiModelProvidersByProviderResponse400
    | PutApiModelProvidersByProviderResponse401
    | PutApiModelProvidersByProviderResponse422
    | PutApiModelProvidersByProviderResponse500
    | None
):
    """Create or update a model provider

    Args:
        provider (str):
        body (PutApiModelProvidersByProviderBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiModelProvidersByProviderResponse200 | PutApiModelProvidersByProviderResponse400 | PutApiModelProvidersByProviderResponse401 | PutApiModelProvidersByProviderResponse422 | PutApiModelProvidersByProviderResponse500
    """

    return sync_detailed(
        provider=provider,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    provider: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelProvidersByProviderBody | Unset = UNSET,
) -> Response[
    PutApiModelProvidersByProviderResponse200
    | PutApiModelProvidersByProviderResponse400
    | PutApiModelProvidersByProviderResponse401
    | PutApiModelProvidersByProviderResponse422
    | PutApiModelProvidersByProviderResponse500
]:
    """Create or update a model provider

    Args:
        provider (str):
        body (PutApiModelProvidersByProviderBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiModelProvidersByProviderResponse200 | PutApiModelProvidersByProviderResponse400 | PutApiModelProvidersByProviderResponse401 | PutApiModelProvidersByProviderResponse422 | PutApiModelProvidersByProviderResponse500]
    """

    kwargs = _get_kwargs(
        provider=provider,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    provider: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelProvidersByProviderBody | Unset = UNSET,
) -> (
    PutApiModelProvidersByProviderResponse200
    | PutApiModelProvidersByProviderResponse400
    | PutApiModelProvidersByProviderResponse401
    | PutApiModelProvidersByProviderResponse422
    | PutApiModelProvidersByProviderResponse500
    | None
):
    """Create or update a model provider

    Args:
        provider (str):
        body (PutApiModelProvidersByProviderBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiModelProvidersByProviderResponse200 | PutApiModelProvidersByProviderResponse400 | PutApiModelProvidersByProviderResponse401 | PutApiModelProvidersByProviderResponse422 | PutApiModelProvidersByProviderResponse500
    """

    return (
        await asyncio_detailed(
            provider=provider,
            client=client,
            body=body,
        )
    ).parsed
