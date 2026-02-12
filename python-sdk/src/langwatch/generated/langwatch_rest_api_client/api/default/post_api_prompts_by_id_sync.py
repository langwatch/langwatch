from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_prompts_by_id_sync_body import PostApiPromptsByIdSyncBody
from ...models.post_api_prompts_by_id_sync_response_200 import PostApiPromptsByIdSyncResponse200
from ...models.post_api_prompts_by_id_sync_response_400 import PostApiPromptsByIdSyncResponse400
from ...models.post_api_prompts_by_id_sync_response_401 import PostApiPromptsByIdSyncResponse401
from ...models.post_api_prompts_by_id_sync_response_422 import PostApiPromptsByIdSyncResponse422
from ...models.post_api_prompts_by_id_sync_response_500 import PostApiPromptsByIdSyncResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PostApiPromptsByIdSyncBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/prompts/{id}/sync".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiPromptsByIdSyncResponse200
    | PostApiPromptsByIdSyncResponse400
    | PostApiPromptsByIdSyncResponse401
    | PostApiPromptsByIdSyncResponse422
    | PostApiPromptsByIdSyncResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiPromptsByIdSyncResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiPromptsByIdSyncResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiPromptsByIdSyncResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiPromptsByIdSyncResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiPromptsByIdSyncResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiPromptsByIdSyncResponse200
    | PostApiPromptsByIdSyncResponse400
    | PostApiPromptsByIdSyncResponse401
    | PostApiPromptsByIdSyncResponse422
    | PostApiPromptsByIdSyncResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsByIdSyncBody | Unset = UNSET,
) -> Response[
    PostApiPromptsByIdSyncResponse200
    | PostApiPromptsByIdSyncResponse400
    | PostApiPromptsByIdSyncResponse401
    | PostApiPromptsByIdSyncResponse422
    | PostApiPromptsByIdSyncResponse500
]:
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsByIdSyncResponse200 | PostApiPromptsByIdSyncResponse400 | PostApiPromptsByIdSyncResponse401 | PostApiPromptsByIdSyncResponse422 | PostApiPromptsByIdSyncResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsByIdSyncBody | Unset = UNSET,
) -> (
    PostApiPromptsByIdSyncResponse200
    | PostApiPromptsByIdSyncResponse400
    | PostApiPromptsByIdSyncResponse401
    | PostApiPromptsByIdSyncResponse422
    | PostApiPromptsByIdSyncResponse500
    | None
):
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsByIdSyncResponse200 | PostApiPromptsByIdSyncResponse400 | PostApiPromptsByIdSyncResponse401 | PostApiPromptsByIdSyncResponse422 | PostApiPromptsByIdSyncResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsByIdSyncBody | Unset = UNSET,
) -> Response[
    PostApiPromptsByIdSyncResponse200
    | PostApiPromptsByIdSyncResponse400
    | PostApiPromptsByIdSyncResponse401
    | PostApiPromptsByIdSyncResponse422
    | PostApiPromptsByIdSyncResponse500
]:
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsByIdSyncResponse200 | PostApiPromptsByIdSyncResponse400 | PostApiPromptsByIdSyncResponse401 | PostApiPromptsByIdSyncResponse422 | PostApiPromptsByIdSyncResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiPromptsByIdSyncBody | Unset = UNSET,
) -> (
    PostApiPromptsByIdSyncResponse200
    | PostApiPromptsByIdSyncResponse400
    | PostApiPromptsByIdSyncResponse401
    | PostApiPromptsByIdSyncResponse422
    | PostApiPromptsByIdSyncResponse500
    | None
):
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsByIdSyncResponse200 | PostApiPromptsByIdSyncResponse400 | PostApiPromptsByIdSyncResponse401 | PostApiPromptsByIdSyncResponse422 | PostApiPromptsByIdSyncResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
