from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_virtual_keys_by_id_revoke_response_200 import (
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200,
)
from ...models.post_api_gateway_v1_virtual_keys_by_id_revoke_response_400 import (
    PostApiGatewayV1VirtualKeysByIdRevokeResponse400,
)
from ...models.post_api_gateway_v1_virtual_keys_by_id_revoke_response_401 import (
    PostApiGatewayV1VirtualKeysByIdRevokeResponse401,
)
from ...models.post_api_gateway_v1_virtual_keys_by_id_revoke_response_403 import (
    PostApiGatewayV1VirtualKeysByIdRevokeResponse403,
)
from ...models.post_api_gateway_v1_virtual_keys_by_id_revoke_response_500 import (
    PostApiGatewayV1VirtualKeysByIdRevokeResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/virtual-keys/{id}/revoke".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse400
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse401
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse403
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGatewayV1VirtualKeysByIdRevokeResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGatewayV1VirtualKeysByIdRevokeResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1VirtualKeysByIdRevokeResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1VirtualKeysByIdRevokeResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiGatewayV1VirtualKeysByIdRevokeResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse400
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse401
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse403
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
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
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse400
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse401
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse403
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
]:
    """Revoke virtual key

     Marks the virtual key as revoked and archives its own budgets. Clients using it start receiving 401
    within ~60s (the gateway's change-event long-poll period). Idempotent.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1VirtualKeysByIdRevokeResponse200 | PostApiGatewayV1VirtualKeysByIdRevokeResponse400 | PostApiGatewayV1VirtualKeysByIdRevokeResponse401 | PostApiGatewayV1VirtualKeysByIdRevokeResponse403 | PostApiGatewayV1VirtualKeysByIdRevokeResponse500]
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
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse400
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse401
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse403
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
    | None
):
    """Revoke virtual key

     Marks the virtual key as revoked and archives its own budgets. Clients using it start receiving 401
    within ~60s (the gateway's change-event long-poll period). Idempotent.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1VirtualKeysByIdRevokeResponse200 | PostApiGatewayV1VirtualKeysByIdRevokeResponse400 | PostApiGatewayV1VirtualKeysByIdRevokeResponse401 | PostApiGatewayV1VirtualKeysByIdRevokeResponse403 | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
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
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse400
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse401
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse403
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
]:
    """Revoke virtual key

     Marks the virtual key as revoked and archives its own budgets. Clients using it start receiving 401
    within ~60s (the gateway's change-event long-poll period). Idempotent.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1VirtualKeysByIdRevokeResponse200 | PostApiGatewayV1VirtualKeysByIdRevokeResponse400 | PostApiGatewayV1VirtualKeysByIdRevokeResponse401 | PostApiGatewayV1VirtualKeysByIdRevokeResponse403 | PostApiGatewayV1VirtualKeysByIdRevokeResponse500]
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
    PostApiGatewayV1VirtualKeysByIdRevokeResponse200
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse400
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse401
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse403
    | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
    | None
):
    """Revoke virtual key

     Marks the virtual key as revoked and archives its own budgets. Clients using it start receiving 401
    within ~60s (the gateway's change-event long-poll period). Idempotent.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1VirtualKeysByIdRevokeResponse200 | PostApiGatewayV1VirtualKeysByIdRevokeResponse400 | PostApiGatewayV1VirtualKeysByIdRevokeResponse401 | PostApiGatewayV1VirtualKeysByIdRevokeResponse403 | PostApiGatewayV1VirtualKeysByIdRevokeResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
