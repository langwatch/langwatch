from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_prompts_tags_body import PostApiPromptsTagsBody
from ...models.post_api_prompts_tags_response_201 import PostApiPromptsTagsResponse201
from ...models.post_api_prompts_tags_response_400 import PostApiPromptsTagsResponse400
from ...models.post_api_prompts_tags_response_401 import PostApiPromptsTagsResponse401
from ...models.post_api_prompts_tags_response_422 import PostApiPromptsTagsResponse422
from ...models.post_api_prompts_tags_response_500 import PostApiPromptsTagsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiPromptsTagsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/prompts/tags",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiPromptsTagsResponse201
    | PostApiPromptsTagsResponse400
    | PostApiPromptsTagsResponse401
    | PostApiPromptsTagsResponse422
    | PostApiPromptsTagsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiPromptsTagsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiPromptsTagsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiPromptsTagsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiPromptsTagsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiPromptsTagsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiPromptsTagsResponse201
    | PostApiPromptsTagsResponse400
    | PostApiPromptsTagsResponse401
    | PostApiPromptsTagsResponse422
    | PostApiPromptsTagsResponse500
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
    body: PostApiPromptsTagsBody | Unset = UNSET,
) -> Response[
    PostApiPromptsTagsResponse201
    | PostApiPromptsTagsResponse400
    | PostApiPromptsTagsResponse401
    | PostApiPromptsTagsResponse422
    | PostApiPromptsTagsResponse500
]:
    """Create a custom prompt tag definition for the organization

    Args:
        body (PostApiPromptsTagsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsTagsResponse201 | PostApiPromptsTagsResponse400 | PostApiPromptsTagsResponse401 | PostApiPromptsTagsResponse422 | PostApiPromptsTagsResponse500]
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
    body: PostApiPromptsTagsBody | Unset = UNSET,
) -> (
    PostApiPromptsTagsResponse201
    | PostApiPromptsTagsResponse400
    | PostApiPromptsTagsResponse401
    | PostApiPromptsTagsResponse422
    | PostApiPromptsTagsResponse500
    | None
):
    """Create a custom prompt tag definition for the organization

    Args:
        body (PostApiPromptsTagsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsTagsResponse201 | PostApiPromptsTagsResponse400 | PostApiPromptsTagsResponse401 | PostApiPromptsTagsResponse422 | PostApiPromptsTagsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsTagsBody | Unset = UNSET,
) -> Response[
    PostApiPromptsTagsResponse201
    | PostApiPromptsTagsResponse400
    | PostApiPromptsTagsResponse401
    | PostApiPromptsTagsResponse422
    | PostApiPromptsTagsResponse500
]:
    """Create a custom prompt tag definition for the organization

    Args:
        body (PostApiPromptsTagsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsTagsResponse201 | PostApiPromptsTagsResponse400 | PostApiPromptsTagsResponse401 | PostApiPromptsTagsResponse422 | PostApiPromptsTagsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsTagsBody | Unset = UNSET,
) -> (
    PostApiPromptsTagsResponse201
    | PostApiPromptsTagsResponse400
    | PostApiPromptsTagsResponse401
    | PostApiPromptsTagsResponse422
    | PostApiPromptsTagsResponse500
    | None
):
    """Create a custom prompt tag definition for the organization

    Args:
        body (PostApiPromptsTagsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsTagsResponse201 | PostApiPromptsTagsResponse400 | PostApiPromptsTagsResponse401 | PostApiPromptsTagsResponse422 | PostApiPromptsTagsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
