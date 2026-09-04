from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_providers_response_400 import PostApiGatewayV1ProvidersResponse400
from ...models.post_api_gateway_v1_providers_response_401 import PostApiGatewayV1ProvidersResponse401
from ...models.post_api_gateway_v1_providers_response_403 import PostApiGatewayV1ProvidersResponse403
from ...models.post_api_gateway_v1_providers_response_410 import PostApiGatewayV1ProvidersResponse410
from ...models.post_api_gateway_v1_providers_response_500 import PostApiGatewayV1ProvidersResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/providers",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1ProvidersResponse400
    | PostApiGatewayV1ProvidersResponse401
    | PostApiGatewayV1ProvidersResponse403
    | PostApiGatewayV1ProvidersResponse410
    | PostApiGatewayV1ProvidersResponse500
    | None
):
    if response.status_code == 400:
        response_400 = PostApiGatewayV1ProvidersResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1ProvidersResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1ProvidersResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 410:
        response_410 = PostApiGatewayV1ProvidersResponse410.from_dict(response.json())

        return response_410

    if response.status_code == 500:
        response_500 = PostApiGatewayV1ProvidersResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1ProvidersResponse400
    | PostApiGatewayV1ProvidersResponse401
    | PostApiGatewayV1ProvidersResponse403
    | PostApiGatewayV1ProvidersResponse410
    | PostApiGatewayV1ProvidersResponse500
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
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiGatewayV1ProvidersResponse400
    | PostApiGatewayV1ProvidersResponse401
    | PostApiGatewayV1ProvidersResponse403
    | PostApiGatewayV1ProvidersResponse410
    | PostApiGatewayV1ProvidersResponse500
]:
    """Bind a model provider to the gateway

     Creates a GatewayProviderCredential binding. Reuses the ModelProvider API key already configured in
    project settings; this only adds gateway-specific settings (rate limits, rotation, fallback
    priority).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1ProvidersResponse400 | PostApiGatewayV1ProvidersResponse401 | PostApiGatewayV1ProvidersResponse403 | PostApiGatewayV1ProvidersResponse410 | PostApiGatewayV1ProvidersResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    PostApiGatewayV1ProvidersResponse400
    | PostApiGatewayV1ProvidersResponse401
    | PostApiGatewayV1ProvidersResponse403
    | PostApiGatewayV1ProvidersResponse410
    | PostApiGatewayV1ProvidersResponse500
    | None
):
    """Bind a model provider to the gateway

     Creates a GatewayProviderCredential binding. Reuses the ModelProvider API key already configured in
    project settings; this only adds gateway-specific settings (rate limits, rotation, fallback
    priority).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1ProvidersResponse400 | PostApiGatewayV1ProvidersResponse401 | PostApiGatewayV1ProvidersResponse403 | PostApiGatewayV1ProvidersResponse410 | PostApiGatewayV1ProvidersResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiGatewayV1ProvidersResponse400
    | PostApiGatewayV1ProvidersResponse401
    | PostApiGatewayV1ProvidersResponse403
    | PostApiGatewayV1ProvidersResponse410
    | PostApiGatewayV1ProvidersResponse500
]:
    """Bind a model provider to the gateway

     Creates a GatewayProviderCredential binding. Reuses the ModelProvider API key already configured in
    project settings; this only adds gateway-specific settings (rate limits, rotation, fallback
    priority).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1ProvidersResponse400 | PostApiGatewayV1ProvidersResponse401 | PostApiGatewayV1ProvidersResponse403 | PostApiGatewayV1ProvidersResponse410 | PostApiGatewayV1ProvidersResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    PostApiGatewayV1ProvidersResponse400
    | PostApiGatewayV1ProvidersResponse401
    | PostApiGatewayV1ProvidersResponse403
    | PostApiGatewayV1ProvidersResponse410
    | PostApiGatewayV1ProvidersResponse500
    | None
):
    """Bind a model provider to the gateway

     Creates a GatewayProviderCredential binding. Reuses the ModelProvider API key already configured in
    project settings; this only adds gateway-specific settings (rate limits, rotation, fallback
    priority).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1ProvidersResponse400 | PostApiGatewayV1ProvidersResponse401 | PostApiGatewayV1ProvidersResponse403 | PostApiGatewayV1ProvidersResponse410 | PostApiGatewayV1ProvidersResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
