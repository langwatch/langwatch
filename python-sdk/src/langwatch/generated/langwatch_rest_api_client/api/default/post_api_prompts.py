from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_prompts_body import PostApiPromptsBody
from ...models.post_api_prompts_response_200 import PostApiPromptsResponse200
from ...models.post_api_prompts_response_400 import PostApiPromptsResponse400
from ...models.post_api_prompts_response_401 import PostApiPromptsResponse401
from ...models.post_api_prompts_response_409 import PostApiPromptsResponse409
from ...models.post_api_prompts_response_422 import PostApiPromptsResponse422
from ...models.post_api_prompts_response_500 import PostApiPromptsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiPromptsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/prompts",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiPromptsResponse200
    | PostApiPromptsResponse400
    | PostApiPromptsResponse401
    | PostApiPromptsResponse409
    | PostApiPromptsResponse422
    | PostApiPromptsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiPromptsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiPromptsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiPromptsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 409:
        response_409 = PostApiPromptsResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiPromptsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiPromptsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiPromptsResponse200
    | PostApiPromptsResponse400
    | PostApiPromptsResponse401
    | PostApiPromptsResponse409
    | PostApiPromptsResponse422
    | PostApiPromptsResponse500
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
    body: PostApiPromptsBody | Unset = UNSET,
) -> Response[
    PostApiPromptsResponse200
    | PostApiPromptsResponse400
    | PostApiPromptsResponse401
    | PostApiPromptsResponse409
    | PostApiPromptsResponse422
    | PostApiPromptsResponse500
]:
    """Create a new prompt with default initial version

    Args:
        body (PostApiPromptsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsResponse200 | PostApiPromptsResponse400 | PostApiPromptsResponse401 | PostApiPromptsResponse409 | PostApiPromptsResponse422 | PostApiPromptsResponse500]
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
    body: PostApiPromptsBody | Unset = UNSET,
) -> (
    PostApiPromptsResponse200
    | PostApiPromptsResponse400
    | PostApiPromptsResponse401
    | PostApiPromptsResponse409
    | PostApiPromptsResponse422
    | PostApiPromptsResponse500
    | None
):
    """Create a new prompt with default initial version

    Args:
        body (PostApiPromptsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsResponse200 | PostApiPromptsResponse400 | PostApiPromptsResponse401 | PostApiPromptsResponse409 | PostApiPromptsResponse422 | PostApiPromptsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsBody | Unset = UNSET,
) -> Response[
    PostApiPromptsResponse200
    | PostApiPromptsResponse400
    | PostApiPromptsResponse401
    | PostApiPromptsResponse409
    | PostApiPromptsResponse422
    | PostApiPromptsResponse500
]:
    """Create a new prompt with default initial version

    Args:
        body (PostApiPromptsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsResponse200 | PostApiPromptsResponse400 | PostApiPromptsResponse401 | PostApiPromptsResponse409 | PostApiPromptsResponse422 | PostApiPromptsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsBody | Unset = UNSET,
) -> (
    PostApiPromptsResponse200
    | PostApiPromptsResponse400
    | PostApiPromptsResponse401
    | PostApiPromptsResponse409
    | PostApiPromptsResponse422
    | PostApiPromptsResponse500
    | None
):
    """Create a new prompt with default initial version

    Args:
        body (PostApiPromptsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsResponse200 | PostApiPromptsResponse400 | PostApiPromptsResponse401 | PostApiPromptsResponse409 | PostApiPromptsResponse422 | PostApiPromptsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
