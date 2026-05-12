from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_traces_search_body import PostApiTracesSearchBody
from ...models.post_api_traces_search_response_200 import PostApiTracesSearchResponse200
from ...models.post_api_traces_search_response_400 import PostApiTracesSearchResponse400
from ...models.post_api_traces_search_response_401 import PostApiTracesSearchResponse401
from ...models.post_api_traces_search_response_422 import PostApiTracesSearchResponse422
from ...models.post_api_traces_search_response_500 import PostApiTracesSearchResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiTracesSearchBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/traces/search",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiTracesSearchResponse200
    | PostApiTracesSearchResponse400
    | PostApiTracesSearchResponse401
    | PostApiTracesSearchResponse422
    | PostApiTracesSearchResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiTracesSearchResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiTracesSearchResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiTracesSearchResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiTracesSearchResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiTracesSearchResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiTracesSearchResponse200
    | PostApiTracesSearchResponse400
    | PostApiTracesSearchResponse401
    | PostApiTracesSearchResponse422
    | PostApiTracesSearchResponse500
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
    body: PostApiTracesSearchBody | Unset = UNSET,
) -> Response[
    PostApiTracesSearchResponse200
    | PostApiTracesSearchResponse400
    | PostApiTracesSearchResponse401
    | PostApiTracesSearchResponse422
    | PostApiTracesSearchResponse500
]:
    """Search traces for a project

    Args:
        body (PostApiTracesSearchBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTracesSearchResponse200 | PostApiTracesSearchResponse400 | PostApiTracesSearchResponse401 | PostApiTracesSearchResponse422 | PostApiTracesSearchResponse500]
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
    body: PostApiTracesSearchBody | Unset = UNSET,
) -> (
    PostApiTracesSearchResponse200
    | PostApiTracesSearchResponse400
    | PostApiTracesSearchResponse401
    | PostApiTracesSearchResponse422
    | PostApiTracesSearchResponse500
    | None
):
    """Search traces for a project

    Args:
        body (PostApiTracesSearchBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTracesSearchResponse200 | PostApiTracesSearchResponse400 | PostApiTracesSearchResponse401 | PostApiTracesSearchResponse422 | PostApiTracesSearchResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiTracesSearchBody | Unset = UNSET,
) -> Response[
    PostApiTracesSearchResponse200
    | PostApiTracesSearchResponse400
    | PostApiTracesSearchResponse401
    | PostApiTracesSearchResponse422
    | PostApiTracesSearchResponse500
]:
    """Search traces for a project

    Args:
        body (PostApiTracesSearchBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTracesSearchResponse200 | PostApiTracesSearchResponse400 | PostApiTracesSearchResponse401 | PostApiTracesSearchResponse422 | PostApiTracesSearchResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiTracesSearchBody | Unset = UNSET,
) -> (
    PostApiTracesSearchResponse200
    | PostApiTracesSearchResponse400
    | PostApiTracesSearchResponse401
    | PostApiTracesSearchResponse422
    | PostApiTracesSearchResponse500
    | None
):
    """Search traces for a project

    Args:
        body (PostApiTracesSearchBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTracesSearchResponse200 | PostApiTracesSearchResponse400 | PostApiTracesSearchResponse401 | PostApiTracesSearchResponse422 | PostApiTracesSearchResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
