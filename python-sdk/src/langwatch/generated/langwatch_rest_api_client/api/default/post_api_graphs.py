from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_graphs_body import PostApiGraphsBody
from ...models.post_api_graphs_response_201 import PostApiGraphsResponse201
from ...models.post_api_graphs_response_400 import PostApiGraphsResponse400
from ...models.post_api_graphs_response_401 import PostApiGraphsResponse401
from ...models.post_api_graphs_response_422 import PostApiGraphsResponse422
from ...models.post_api_graphs_response_500 import PostApiGraphsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiGraphsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/graphs",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGraphsResponse201
    | PostApiGraphsResponse400
    | PostApiGraphsResponse401
    | PostApiGraphsResponse422
    | PostApiGraphsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiGraphsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiGraphsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGraphsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiGraphsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGraphsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGraphsResponse201
    | PostApiGraphsResponse400
    | PostApiGraphsResponse401
    | PostApiGraphsResponse422
    | PostApiGraphsResponse500
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
    body: PostApiGraphsBody | Unset = UNSET,
) -> Response[
    PostApiGraphsResponse201
    | PostApiGraphsResponse400
    | PostApiGraphsResponse401
    | PostApiGraphsResponse422
    | PostApiGraphsResponse500
]:
    """Create a custom graph on a dashboard

    Args:
        body (PostApiGraphsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGraphsResponse201 | PostApiGraphsResponse400 | PostApiGraphsResponse401 | PostApiGraphsResponse422 | PostApiGraphsResponse500]
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
    body: PostApiGraphsBody | Unset = UNSET,
) -> (
    PostApiGraphsResponse201
    | PostApiGraphsResponse400
    | PostApiGraphsResponse401
    | PostApiGraphsResponse422
    | PostApiGraphsResponse500
    | None
):
    """Create a custom graph on a dashboard

    Args:
        body (PostApiGraphsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGraphsResponse201 | PostApiGraphsResponse400 | PostApiGraphsResponse401 | PostApiGraphsResponse422 | PostApiGraphsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGraphsBody | Unset = UNSET,
) -> Response[
    PostApiGraphsResponse201
    | PostApiGraphsResponse400
    | PostApiGraphsResponse401
    | PostApiGraphsResponse422
    | PostApiGraphsResponse500
]:
    """Create a custom graph on a dashboard

    Args:
        body (PostApiGraphsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGraphsResponse201 | PostApiGraphsResponse400 | PostApiGraphsResponse401 | PostApiGraphsResponse422 | PostApiGraphsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGraphsBody | Unset = UNSET,
) -> (
    PostApiGraphsResponse201
    | PostApiGraphsResponse400
    | PostApiGraphsResponse401
    | PostApiGraphsResponse422
    | PostApiGraphsResponse500
    | None
):
    """Create a custom graph on a dashboard

    Args:
        body (PostApiGraphsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGraphsResponse201 | PostApiGraphsResponse400 | PostApiGraphsResponse401 | PostApiGraphsResponse422 | PostApiGraphsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
