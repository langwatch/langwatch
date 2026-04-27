from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_suites_body import PostApiSuitesBody
from ...models.post_api_suites_response_201 import PostApiSuitesResponse201
from ...models.post_api_suites_response_400 import PostApiSuitesResponse400
from ...models.post_api_suites_response_401 import PostApiSuitesResponse401
from ...models.post_api_suites_response_422 import PostApiSuitesResponse422
from ...models.post_api_suites_response_500 import PostApiSuitesResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiSuitesBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/suites",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiSuitesResponse201
    | PostApiSuitesResponse400
    | PostApiSuitesResponse401
    | PostApiSuitesResponse422
    | PostApiSuitesResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiSuitesResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiSuitesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiSuitesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiSuitesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiSuitesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiSuitesResponse201
    | PostApiSuitesResponse400
    | PostApiSuitesResponse401
    | PostApiSuitesResponse422
    | PostApiSuitesResponse500
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
    body: PostApiSuitesBody | Unset = UNSET,
) -> Response[
    PostApiSuitesResponse201
    | PostApiSuitesResponse400
    | PostApiSuitesResponse401
    | PostApiSuitesResponse422
    | PostApiSuitesResponse500
]:
    """Create a new suite (run plan)

    Args:
        body (PostApiSuitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiSuitesResponse201 | PostApiSuitesResponse400 | PostApiSuitesResponse401 | PostApiSuitesResponse422 | PostApiSuitesResponse500]
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
    body: PostApiSuitesBody | Unset = UNSET,
) -> (
    PostApiSuitesResponse201
    | PostApiSuitesResponse400
    | PostApiSuitesResponse401
    | PostApiSuitesResponse422
    | PostApiSuitesResponse500
    | None
):
    """Create a new suite (run plan)

    Args:
        body (PostApiSuitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiSuitesResponse201 | PostApiSuitesResponse400 | PostApiSuitesResponse401 | PostApiSuitesResponse422 | PostApiSuitesResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiSuitesBody | Unset = UNSET,
) -> Response[
    PostApiSuitesResponse201
    | PostApiSuitesResponse400
    | PostApiSuitesResponse401
    | PostApiSuitesResponse422
    | PostApiSuitesResponse500
]:
    """Create a new suite (run plan)

    Args:
        body (PostApiSuitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiSuitesResponse201 | PostApiSuitesResponse400 | PostApiSuitesResponse401 | PostApiSuitesResponse422 | PostApiSuitesResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiSuitesBody | Unset = UNSET,
) -> (
    PostApiSuitesResponse201
    | PostApiSuitesResponse400
    | PostApiSuitesResponse401
    | PostApiSuitesResponse422
    | PostApiSuitesResponse500
    | None
):
    """Create a new suite (run plan)

    Args:
        body (PostApiSuitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiSuitesResponse201 | PostApiSuitesResponse400 | PostApiSuitesResponse401 | PostApiSuitesResponse422 | PostApiSuitesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
