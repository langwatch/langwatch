from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_triggers_body import PostApiTriggersBody
from ...models.post_api_triggers_response_201 import PostApiTriggersResponse201
from ...models.post_api_triggers_response_400 import PostApiTriggersResponse400
from ...models.post_api_triggers_response_401 import PostApiTriggersResponse401
from ...models.post_api_triggers_response_422 import PostApiTriggersResponse422
from ...models.post_api_triggers_response_500 import PostApiTriggersResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiTriggersBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/triggers",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiTriggersResponse201
    | PostApiTriggersResponse400
    | PostApiTriggersResponse401
    | PostApiTriggersResponse422
    | PostApiTriggersResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiTriggersResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiTriggersResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiTriggersResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiTriggersResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiTriggersResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiTriggersResponse201
    | PostApiTriggersResponse400
    | PostApiTriggersResponse401
    | PostApiTriggersResponse422
    | PostApiTriggersResponse500
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
    body: PostApiTriggersBody | Unset = UNSET,
) -> Response[
    PostApiTriggersResponse201
    | PostApiTriggersResponse400
    | PostApiTriggersResponse401
    | PostApiTriggersResponse422
    | PostApiTriggersResponse500
]:
    """Create a new trigger (automation)

    Args:
        body (PostApiTriggersBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersResponse201 | PostApiTriggersResponse400 | PostApiTriggersResponse401 | PostApiTriggersResponse422 | PostApiTriggersResponse500]
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
    body: PostApiTriggersBody | Unset = UNSET,
) -> (
    PostApiTriggersResponse201
    | PostApiTriggersResponse400
    | PostApiTriggersResponse401
    | PostApiTriggersResponse422
    | PostApiTriggersResponse500
    | None
):
    """Create a new trigger (automation)

    Args:
        body (PostApiTriggersBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersResponse201 | PostApiTriggersResponse400 | PostApiTriggersResponse401 | PostApiTriggersResponse422 | PostApiTriggersResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiTriggersBody | Unset = UNSET,
) -> Response[
    PostApiTriggersResponse201
    | PostApiTriggersResponse400
    | PostApiTriggersResponse401
    | PostApiTriggersResponse422
    | PostApiTriggersResponse500
]:
    """Create a new trigger (automation)

    Args:
        body (PostApiTriggersBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersResponse201 | PostApiTriggersResponse400 | PostApiTriggersResponse401 | PostApiTriggersResponse422 | PostApiTriggersResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiTriggersBody | Unset = UNSET,
) -> (
    PostApiTriggersResponse201
    | PostApiTriggersResponse400
    | PostApiTriggersResponse401
    | PostApiTriggersResponse422
    | PostApiTriggersResponse500
    | None
):
    """Create a new trigger (automation)

    Args:
        body (PostApiTriggersBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersResponse201 | PostApiTriggersResponse400 | PostApiTriggersResponse401 | PostApiTriggersResponse422 | PostApiTriggersResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
