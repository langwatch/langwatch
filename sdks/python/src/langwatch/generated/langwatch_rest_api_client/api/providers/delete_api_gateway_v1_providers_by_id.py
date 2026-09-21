from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_gateway_v1_providers_by_id_response_400 import DeleteApiGatewayV1ProvidersByIdResponse400
from ...models.delete_api_gateway_v1_providers_by_id_response_401 import DeleteApiGatewayV1ProvidersByIdResponse401
from ...models.delete_api_gateway_v1_providers_by_id_response_403 import DeleteApiGatewayV1ProvidersByIdResponse403
from ...models.delete_api_gateway_v1_providers_by_id_response_410 import DeleteApiGatewayV1ProvidersByIdResponse410
from ...models.delete_api_gateway_v1_providers_by_id_response_500 import DeleteApiGatewayV1ProvidersByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/gateway/v1/providers/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiGatewayV1ProvidersByIdResponse400
    | DeleteApiGatewayV1ProvidersByIdResponse401
    | DeleteApiGatewayV1ProvidersByIdResponse403
    | DeleteApiGatewayV1ProvidersByIdResponse410
    | DeleteApiGatewayV1ProvidersByIdResponse500
    | None
):
    if response.status_code == 400:
        response_400 = DeleteApiGatewayV1ProvidersByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiGatewayV1ProvidersByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiGatewayV1ProvidersByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 410:
        response_410 = DeleteApiGatewayV1ProvidersByIdResponse410.from_dict(response.json())

        return response_410

    if response.status_code == 500:
        response_500 = DeleteApiGatewayV1ProvidersByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiGatewayV1ProvidersByIdResponse400
    | DeleteApiGatewayV1ProvidersByIdResponse401
    | DeleteApiGatewayV1ProvidersByIdResponse403
    | DeleteApiGatewayV1ProvidersByIdResponse410
    | DeleteApiGatewayV1ProvidersByIdResponse500
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
    client: AuthenticatedClient,
) -> Response[
    DeleteApiGatewayV1ProvidersByIdResponse400
    | DeleteApiGatewayV1ProvidersByIdResponse401
    | DeleteApiGatewayV1ProvidersByIdResponse403
    | DeleteApiGatewayV1ProvidersByIdResponse410
    | DeleteApiGatewayV1ProvidersByIdResponse500
]:
    """Disable provider binding

     Marks the binding disabled. Requests routing to this slot are skipped (fallback chain continues).
    Historical ledger rows are retained.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGatewayV1ProvidersByIdResponse400 | DeleteApiGatewayV1ProvidersByIdResponse401 | DeleteApiGatewayV1ProvidersByIdResponse403 | DeleteApiGatewayV1ProvidersByIdResponse410 | DeleteApiGatewayV1ProvidersByIdResponse500]
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
    client: AuthenticatedClient,
) -> (
    DeleteApiGatewayV1ProvidersByIdResponse400
    | DeleteApiGatewayV1ProvidersByIdResponse401
    | DeleteApiGatewayV1ProvidersByIdResponse403
    | DeleteApiGatewayV1ProvidersByIdResponse410
    | DeleteApiGatewayV1ProvidersByIdResponse500
    | None
):
    """Disable provider binding

     Marks the binding disabled. Requests routing to this slot are skipped (fallback chain continues).
    Historical ledger rows are retained.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGatewayV1ProvidersByIdResponse400 | DeleteApiGatewayV1ProvidersByIdResponse401 | DeleteApiGatewayV1ProvidersByIdResponse403 | DeleteApiGatewayV1ProvidersByIdResponse410 | DeleteApiGatewayV1ProvidersByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiGatewayV1ProvidersByIdResponse400
    | DeleteApiGatewayV1ProvidersByIdResponse401
    | DeleteApiGatewayV1ProvidersByIdResponse403
    | DeleteApiGatewayV1ProvidersByIdResponse410
    | DeleteApiGatewayV1ProvidersByIdResponse500
]:
    """Disable provider binding

     Marks the binding disabled. Requests routing to this slot are skipped (fallback chain continues).
    Historical ledger rows are retained.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGatewayV1ProvidersByIdResponse400 | DeleteApiGatewayV1ProvidersByIdResponse401 | DeleteApiGatewayV1ProvidersByIdResponse403 | DeleteApiGatewayV1ProvidersByIdResponse410 | DeleteApiGatewayV1ProvidersByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiGatewayV1ProvidersByIdResponse400
    | DeleteApiGatewayV1ProvidersByIdResponse401
    | DeleteApiGatewayV1ProvidersByIdResponse403
    | DeleteApiGatewayV1ProvidersByIdResponse410
    | DeleteApiGatewayV1ProvidersByIdResponse500
    | None
):
    """Disable provider binding

     Marks the binding disabled. Requests routing to this slot are skipped (fallback chain continues).
    Historical ledger rows are retained.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGatewayV1ProvidersByIdResponse400 | DeleteApiGatewayV1ProvidersByIdResponse401 | DeleteApiGatewayV1ProvidersByIdResponse403 | DeleteApiGatewayV1ProvidersByIdResponse410 | DeleteApiGatewayV1ProvidersByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
