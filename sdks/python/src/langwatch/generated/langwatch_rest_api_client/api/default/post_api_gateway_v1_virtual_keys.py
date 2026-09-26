from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_virtual_keys_body import PostApiGatewayV1VirtualKeysBody
from ...models.post_api_gateway_v1_virtual_keys_response_201 import PostApiGatewayV1VirtualKeysResponse201
from ...models.post_api_gateway_v1_virtual_keys_response_400 import PostApiGatewayV1VirtualKeysResponse400
from ...models.post_api_gateway_v1_virtual_keys_response_401 import PostApiGatewayV1VirtualKeysResponse401
from ...models.post_api_gateway_v1_virtual_keys_response_403 import PostApiGatewayV1VirtualKeysResponse403
from ...models.post_api_gateway_v1_virtual_keys_response_409 import PostApiGatewayV1VirtualKeysResponse409
from ...models.post_api_gateway_v1_virtual_keys_response_500 import PostApiGatewayV1VirtualKeysResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiGatewayV1VirtualKeysBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/virtual-keys",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1VirtualKeysResponse201
    | PostApiGatewayV1VirtualKeysResponse400
    | PostApiGatewayV1VirtualKeysResponse401
    | PostApiGatewayV1VirtualKeysResponse403
    | PostApiGatewayV1VirtualKeysResponse409
    | PostApiGatewayV1VirtualKeysResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiGatewayV1VirtualKeysResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiGatewayV1VirtualKeysResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1VirtualKeysResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1VirtualKeysResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = PostApiGatewayV1VirtualKeysResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = PostApiGatewayV1VirtualKeysResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1VirtualKeysResponse201
    | PostApiGatewayV1VirtualKeysResponse400
    | PostApiGatewayV1VirtualKeysResponse401
    | PostApiGatewayV1VirtualKeysResponse403
    | PostApiGatewayV1VirtualKeysResponse409
    | PostApiGatewayV1VirtualKeysResponse500
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
    body: PostApiGatewayV1VirtualKeysBody,
) -> Response[
    PostApiGatewayV1VirtualKeysResponse201
    | PostApiGatewayV1VirtualKeysResponse400
    | PostApiGatewayV1VirtualKeysResponse401
    | PostApiGatewayV1VirtualKeysResponse403
    | PostApiGatewayV1VirtualKeysResponse409
    | PostApiGatewayV1VirtualKeysResponse500
]:
    """Create virtual key

     Mints a new virtual key and returns the secret exactly once. scopes defaults to the caller's
    project; org- and team-scoped keys require virtualKeys:manage at each requested scope.

    Args:
        body (PostApiGatewayV1VirtualKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1VirtualKeysResponse201 | PostApiGatewayV1VirtualKeysResponse400 | PostApiGatewayV1VirtualKeysResponse401 | PostApiGatewayV1VirtualKeysResponse403 | PostApiGatewayV1VirtualKeysResponse409 | PostApiGatewayV1VirtualKeysResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiGatewayV1VirtualKeysBody,
) -> (
    PostApiGatewayV1VirtualKeysResponse201
    | PostApiGatewayV1VirtualKeysResponse400
    | PostApiGatewayV1VirtualKeysResponse401
    | PostApiGatewayV1VirtualKeysResponse403
    | PostApiGatewayV1VirtualKeysResponse409
    | PostApiGatewayV1VirtualKeysResponse500
    | None
):
    """Create virtual key

     Mints a new virtual key and returns the secret exactly once. scopes defaults to the caller's
    project; org- and team-scoped keys require virtualKeys:manage at each requested scope.

    Args:
        body (PostApiGatewayV1VirtualKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1VirtualKeysResponse201 | PostApiGatewayV1VirtualKeysResponse400 | PostApiGatewayV1VirtualKeysResponse401 | PostApiGatewayV1VirtualKeysResponse403 | PostApiGatewayV1VirtualKeysResponse409 | PostApiGatewayV1VirtualKeysResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiGatewayV1VirtualKeysBody,
) -> Response[
    PostApiGatewayV1VirtualKeysResponse201
    | PostApiGatewayV1VirtualKeysResponse400
    | PostApiGatewayV1VirtualKeysResponse401
    | PostApiGatewayV1VirtualKeysResponse403
    | PostApiGatewayV1VirtualKeysResponse409
    | PostApiGatewayV1VirtualKeysResponse500
]:
    """Create virtual key

     Mints a new virtual key and returns the secret exactly once. scopes defaults to the caller's
    project; org- and team-scoped keys require virtualKeys:manage at each requested scope.

    Args:
        body (PostApiGatewayV1VirtualKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1VirtualKeysResponse201 | PostApiGatewayV1VirtualKeysResponse400 | PostApiGatewayV1VirtualKeysResponse401 | PostApiGatewayV1VirtualKeysResponse403 | PostApiGatewayV1VirtualKeysResponse409 | PostApiGatewayV1VirtualKeysResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiGatewayV1VirtualKeysBody,
) -> (
    PostApiGatewayV1VirtualKeysResponse201
    | PostApiGatewayV1VirtualKeysResponse400
    | PostApiGatewayV1VirtualKeysResponse401
    | PostApiGatewayV1VirtualKeysResponse403
    | PostApiGatewayV1VirtualKeysResponse409
    | PostApiGatewayV1VirtualKeysResponse500
    | None
):
    """Create virtual key

     Mints a new virtual key and returns the secret exactly once. scopes defaults to the caller's
    project; org- and team-scoped keys require virtualKeys:manage at each requested scope.

    Args:
        body (PostApiGatewayV1VirtualKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1VirtualKeysResponse201 | PostApiGatewayV1VirtualKeysResponse400 | PostApiGatewayV1VirtualKeysResponse401 | PostApiGatewayV1VirtualKeysResponse403 | PostApiGatewayV1VirtualKeysResponse409 | PostApiGatewayV1VirtualKeysResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
