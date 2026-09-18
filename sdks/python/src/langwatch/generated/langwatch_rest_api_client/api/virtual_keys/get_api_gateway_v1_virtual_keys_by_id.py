from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_virtual_keys_by_id_response_200 import GetApiGatewayV1VirtualKeysByIdResponse200
from ...models.get_api_gateway_v1_virtual_keys_by_id_response_400 import GetApiGatewayV1VirtualKeysByIdResponse400
from ...models.get_api_gateway_v1_virtual_keys_by_id_response_401 import GetApiGatewayV1VirtualKeysByIdResponse401
from ...models.get_api_gateway_v1_virtual_keys_by_id_response_403 import GetApiGatewayV1VirtualKeysByIdResponse403
from ...models.get_api_gateway_v1_virtual_keys_by_id_response_404 import GetApiGatewayV1VirtualKeysByIdResponse404
from ...models.get_api_gateway_v1_virtual_keys_by_id_response_500 import GetApiGatewayV1VirtualKeysByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/virtual-keys/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1VirtualKeysByIdResponse200
    | GetApiGatewayV1VirtualKeysByIdResponse400
    | GetApiGatewayV1VirtualKeysByIdResponse401
    | GetApiGatewayV1VirtualKeysByIdResponse403
    | GetApiGatewayV1VirtualKeysByIdResponse404
    | GetApiGatewayV1VirtualKeysByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1VirtualKeysByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1VirtualKeysByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1VirtualKeysByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1VirtualKeysByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiGatewayV1VirtualKeysByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetApiGatewayV1VirtualKeysByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1VirtualKeysByIdResponse200
    | GetApiGatewayV1VirtualKeysByIdResponse400
    | GetApiGatewayV1VirtualKeysByIdResponse401
    | GetApiGatewayV1VirtualKeysByIdResponse403
    | GetApiGatewayV1VirtualKeysByIdResponse404
    | GetApiGatewayV1VirtualKeysByIdResponse500
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
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiGatewayV1VirtualKeysByIdResponse200
    | GetApiGatewayV1VirtualKeysByIdResponse400
    | GetApiGatewayV1VirtualKeysByIdResponse401
    | GetApiGatewayV1VirtualKeysByIdResponse403
    | GetApiGatewayV1VirtualKeysByIdResponse404
    | GetApiGatewayV1VirtualKeysByIdResponse500
]:
    """Get virtual key

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1VirtualKeysByIdResponse200 | GetApiGatewayV1VirtualKeysByIdResponse400 | GetApiGatewayV1VirtualKeysByIdResponse401 | GetApiGatewayV1VirtualKeysByIdResponse403 | GetApiGatewayV1VirtualKeysByIdResponse404 | GetApiGatewayV1VirtualKeysByIdResponse500]
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
    GetApiGatewayV1VirtualKeysByIdResponse200
    | GetApiGatewayV1VirtualKeysByIdResponse400
    | GetApiGatewayV1VirtualKeysByIdResponse401
    | GetApiGatewayV1VirtualKeysByIdResponse403
    | GetApiGatewayV1VirtualKeysByIdResponse404
    | GetApiGatewayV1VirtualKeysByIdResponse500
    | None
):
    """Get virtual key

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1VirtualKeysByIdResponse200 | GetApiGatewayV1VirtualKeysByIdResponse400 | GetApiGatewayV1VirtualKeysByIdResponse401 | GetApiGatewayV1VirtualKeysByIdResponse403 | GetApiGatewayV1VirtualKeysByIdResponse404 | GetApiGatewayV1VirtualKeysByIdResponse500
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
    GetApiGatewayV1VirtualKeysByIdResponse200
    | GetApiGatewayV1VirtualKeysByIdResponse400
    | GetApiGatewayV1VirtualKeysByIdResponse401
    | GetApiGatewayV1VirtualKeysByIdResponse403
    | GetApiGatewayV1VirtualKeysByIdResponse404
    | GetApiGatewayV1VirtualKeysByIdResponse500
]:
    """Get virtual key

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1VirtualKeysByIdResponse200 | GetApiGatewayV1VirtualKeysByIdResponse400 | GetApiGatewayV1VirtualKeysByIdResponse401 | GetApiGatewayV1VirtualKeysByIdResponse403 | GetApiGatewayV1VirtualKeysByIdResponse404 | GetApiGatewayV1VirtualKeysByIdResponse500]
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
    GetApiGatewayV1VirtualKeysByIdResponse200
    | GetApiGatewayV1VirtualKeysByIdResponse400
    | GetApiGatewayV1VirtualKeysByIdResponse401
    | GetApiGatewayV1VirtualKeysByIdResponse403
    | GetApiGatewayV1VirtualKeysByIdResponse404
    | GetApiGatewayV1VirtualKeysByIdResponse500
    | None
):
    """Get virtual key

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1VirtualKeysByIdResponse200 | GetApiGatewayV1VirtualKeysByIdResponse400 | GetApiGatewayV1VirtualKeysByIdResponse401 | GetApiGatewayV1VirtualKeysByIdResponse403 | GetApiGatewayV1VirtualKeysByIdResponse404 | GetApiGatewayV1VirtualKeysByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
