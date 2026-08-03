from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_cache_rules_body import PostApiGatewayV1CacheRulesBody
from ...models.post_api_gateway_v1_cache_rules_response_201 import PostApiGatewayV1CacheRulesResponse201
from ...models.post_api_gateway_v1_cache_rules_response_400 import PostApiGatewayV1CacheRulesResponse400
from ...models.post_api_gateway_v1_cache_rules_response_401 import PostApiGatewayV1CacheRulesResponse401
from ...models.post_api_gateway_v1_cache_rules_response_403 import PostApiGatewayV1CacheRulesResponse403
from ...models.post_api_gateway_v1_cache_rules_response_500 import PostApiGatewayV1CacheRulesResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiGatewayV1CacheRulesBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/cache-rules",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1CacheRulesResponse201
    | PostApiGatewayV1CacheRulesResponse400
    | PostApiGatewayV1CacheRulesResponse401
    | PostApiGatewayV1CacheRulesResponse403
    | PostApiGatewayV1CacheRulesResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiGatewayV1CacheRulesResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiGatewayV1CacheRulesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1CacheRulesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1CacheRulesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiGatewayV1CacheRulesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1CacheRulesResponse201
    | PostApiGatewayV1CacheRulesResponse400
    | PostApiGatewayV1CacheRulesResponse401
    | PostApiGatewayV1CacheRulesResponse403
    | PostApiGatewayV1CacheRulesResponse500
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
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1CacheRulesBody | Unset = UNSET,
) -> Response[
    PostApiGatewayV1CacheRulesResponse201
    | PostApiGatewayV1CacheRulesResponse400
    | PostApiGatewayV1CacheRulesResponse401
    | PostApiGatewayV1CacheRulesResponse403
    | PostApiGatewayV1CacheRulesResponse500
]:
    """Create a cache rule

     Matchers are ANDed across non-null fields; at least one matcher is required. Mode is one of
    respect/force/disable. TTL is clamped to [0, 86400]. Salt is an optional cache-bust tag (max 64
    chars). All writes emit a ChangeEvent so the gateway picks up the new rule within 30 s via its
    /changes long-poll.

    Args:
        body (PostApiGatewayV1CacheRulesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1CacheRulesResponse201 | PostApiGatewayV1CacheRulesResponse400 | PostApiGatewayV1CacheRulesResponse401 | PostApiGatewayV1CacheRulesResponse403 | PostApiGatewayV1CacheRulesResponse500]
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
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1CacheRulesBody | Unset = UNSET,
) -> (
    PostApiGatewayV1CacheRulesResponse201
    | PostApiGatewayV1CacheRulesResponse400
    | PostApiGatewayV1CacheRulesResponse401
    | PostApiGatewayV1CacheRulesResponse403
    | PostApiGatewayV1CacheRulesResponse500
    | None
):
    """Create a cache rule

     Matchers are ANDed across non-null fields; at least one matcher is required. Mode is one of
    respect/force/disable. TTL is clamped to [0, 86400]. Salt is an optional cache-bust tag (max 64
    chars). All writes emit a ChangeEvent so the gateway picks up the new rule within 30 s via its
    /changes long-poll.

    Args:
        body (PostApiGatewayV1CacheRulesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1CacheRulesResponse201 | PostApiGatewayV1CacheRulesResponse400 | PostApiGatewayV1CacheRulesResponse401 | PostApiGatewayV1CacheRulesResponse403 | PostApiGatewayV1CacheRulesResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1CacheRulesBody | Unset = UNSET,
) -> Response[
    PostApiGatewayV1CacheRulesResponse201
    | PostApiGatewayV1CacheRulesResponse400
    | PostApiGatewayV1CacheRulesResponse401
    | PostApiGatewayV1CacheRulesResponse403
    | PostApiGatewayV1CacheRulesResponse500
]:
    """Create a cache rule

     Matchers are ANDed across non-null fields; at least one matcher is required. Mode is one of
    respect/force/disable. TTL is clamped to [0, 86400]. Salt is an optional cache-bust tag (max 64
    chars). All writes emit a ChangeEvent so the gateway picks up the new rule within 30 s via its
    /changes long-poll.

    Args:
        body (PostApiGatewayV1CacheRulesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1CacheRulesResponse201 | PostApiGatewayV1CacheRulesResponse400 | PostApiGatewayV1CacheRulesResponse401 | PostApiGatewayV1CacheRulesResponse403 | PostApiGatewayV1CacheRulesResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1CacheRulesBody | Unset = UNSET,
) -> (
    PostApiGatewayV1CacheRulesResponse201
    | PostApiGatewayV1CacheRulesResponse400
    | PostApiGatewayV1CacheRulesResponse401
    | PostApiGatewayV1CacheRulesResponse403
    | PostApiGatewayV1CacheRulesResponse500
    | None
):
    """Create a cache rule

     Matchers are ANDed across non-null fields; at least one matcher is required. Mode is one of
    respect/force/disable. TTL is clamped to [0, 86400]. Salt is an optional cache-bust tag (max 64
    chars). All writes emit a ChangeEvent so the gateway picks up the new rule within 30 s via its
    /changes long-poll.

    Args:
        body (PostApiGatewayV1CacheRulesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1CacheRulesResponse201 | PostApiGatewayV1CacheRulesResponse400 | PostApiGatewayV1CacheRulesResponse401 | PostApiGatewayV1CacheRulesResponse403 | PostApiGatewayV1CacheRulesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
