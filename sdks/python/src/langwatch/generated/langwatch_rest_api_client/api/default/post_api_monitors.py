from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_monitors_body import PostApiMonitorsBody
from ...models.post_api_monitors_response_201 import PostApiMonitorsResponse201
from ...models.post_api_monitors_response_400 import PostApiMonitorsResponse400
from ...models.post_api_monitors_response_401 import PostApiMonitorsResponse401
from ...models.post_api_monitors_response_422 import PostApiMonitorsResponse422
from ...models.post_api_monitors_response_500 import PostApiMonitorsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiMonitorsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/monitors",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiMonitorsResponse201
    | PostApiMonitorsResponse400
    | PostApiMonitorsResponse401
    | PostApiMonitorsResponse422
    | PostApiMonitorsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiMonitorsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiMonitorsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiMonitorsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiMonitorsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiMonitorsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiMonitorsResponse201
    | PostApiMonitorsResponse400
    | PostApiMonitorsResponse401
    | PostApiMonitorsResponse422
    | PostApiMonitorsResponse500
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
    body: PostApiMonitorsBody | Unset = UNSET,
) -> Response[
    PostApiMonitorsResponse201
    | PostApiMonitorsResponse400
    | PostApiMonitorsResponse401
    | PostApiMonitorsResponse422
    | PostApiMonitorsResponse500
]:
    """Create a new online evaluation monitor

    Args:
        body (PostApiMonitorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiMonitorsResponse201 | PostApiMonitorsResponse400 | PostApiMonitorsResponse401 | PostApiMonitorsResponse422 | PostApiMonitorsResponse500]
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
    body: PostApiMonitorsBody | Unset = UNSET,
) -> (
    PostApiMonitorsResponse201
    | PostApiMonitorsResponse400
    | PostApiMonitorsResponse401
    | PostApiMonitorsResponse422
    | PostApiMonitorsResponse500
    | None
):
    """Create a new online evaluation monitor

    Args:
        body (PostApiMonitorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiMonitorsResponse201 | PostApiMonitorsResponse400 | PostApiMonitorsResponse401 | PostApiMonitorsResponse422 | PostApiMonitorsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiMonitorsBody | Unset = UNSET,
) -> Response[
    PostApiMonitorsResponse201
    | PostApiMonitorsResponse400
    | PostApiMonitorsResponse401
    | PostApiMonitorsResponse422
    | PostApiMonitorsResponse500
]:
    """Create a new online evaluation monitor

    Args:
        body (PostApiMonitorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiMonitorsResponse201 | PostApiMonitorsResponse400 | PostApiMonitorsResponse401 | PostApiMonitorsResponse422 | PostApiMonitorsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiMonitorsBody | Unset = UNSET,
) -> (
    PostApiMonitorsResponse201
    | PostApiMonitorsResponse400
    | PostApiMonitorsResponse401
    | PostApiMonitorsResponse422
    | PostApiMonitorsResponse500
    | None
):
    """Create a new online evaluation monitor

    Args:
        body (PostApiMonitorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiMonitorsResponse201 | PostApiMonitorsResponse400 | PostApiMonitorsResponse401 | PostApiMonitorsResponse422 | PostApiMonitorsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
