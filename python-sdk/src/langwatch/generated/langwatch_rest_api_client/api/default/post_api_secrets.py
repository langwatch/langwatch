from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_secrets_body import PostApiSecretsBody
from ...models.post_api_secrets_response_201 import PostApiSecretsResponse201
from ...models.post_api_secrets_response_400 import PostApiSecretsResponse400
from ...models.post_api_secrets_response_401 import PostApiSecretsResponse401
from ...models.post_api_secrets_response_409 import PostApiSecretsResponse409
from ...models.post_api_secrets_response_422 import PostApiSecretsResponse422
from ...models.post_api_secrets_response_500 import PostApiSecretsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiSecretsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/secrets",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiSecretsResponse201
    | PostApiSecretsResponse400
    | PostApiSecretsResponse401
    | PostApiSecretsResponse409
    | PostApiSecretsResponse422
    | PostApiSecretsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiSecretsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiSecretsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiSecretsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 409:
        response_409 = PostApiSecretsResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiSecretsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiSecretsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiSecretsResponse201
    | PostApiSecretsResponse400
    | PostApiSecretsResponse401
    | PostApiSecretsResponse409
    | PostApiSecretsResponse422
    | PostApiSecretsResponse500
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
    body: PostApiSecretsBody | Unset = UNSET,
) -> Response[
    PostApiSecretsResponse201
    | PostApiSecretsResponse400
    | PostApiSecretsResponse401
    | PostApiSecretsResponse409
    | PostApiSecretsResponse422
    | PostApiSecretsResponse500
]:
    """Create a new project secret. The value is encrypted at rest and never returned.

    Args:
        body (PostApiSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiSecretsResponse201 | PostApiSecretsResponse400 | PostApiSecretsResponse401 | PostApiSecretsResponse409 | PostApiSecretsResponse422 | PostApiSecretsResponse500]
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
    body: PostApiSecretsBody | Unset = UNSET,
) -> (
    PostApiSecretsResponse201
    | PostApiSecretsResponse400
    | PostApiSecretsResponse401
    | PostApiSecretsResponse409
    | PostApiSecretsResponse422
    | PostApiSecretsResponse500
    | None
):
    """Create a new project secret. The value is encrypted at rest and never returned.

    Args:
        body (PostApiSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiSecretsResponse201 | PostApiSecretsResponse400 | PostApiSecretsResponse401 | PostApiSecretsResponse409 | PostApiSecretsResponse422 | PostApiSecretsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiSecretsBody | Unset = UNSET,
) -> Response[
    PostApiSecretsResponse201
    | PostApiSecretsResponse400
    | PostApiSecretsResponse401
    | PostApiSecretsResponse409
    | PostApiSecretsResponse422
    | PostApiSecretsResponse500
]:
    """Create a new project secret. The value is encrypted at rest and never returned.

    Args:
        body (PostApiSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiSecretsResponse201 | PostApiSecretsResponse400 | PostApiSecretsResponse401 | PostApiSecretsResponse409 | PostApiSecretsResponse422 | PostApiSecretsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiSecretsBody | Unset = UNSET,
) -> (
    PostApiSecretsResponse201
    | PostApiSecretsResponse400
    | PostApiSecretsResponse401
    | PostApiSecretsResponse409
    | PostApiSecretsResponse422
    | PostApiSecretsResponse500
    | None
):
    """Create a new project secret. The value is encrypted at rest and never returned.

    Args:
        body (PostApiSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiSecretsResponse201 | PostApiSecretsResponse400 | PostApiSecretsResponse401 | PostApiSecretsResponse409 | PostApiSecretsResponse422 | PostApiSecretsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
