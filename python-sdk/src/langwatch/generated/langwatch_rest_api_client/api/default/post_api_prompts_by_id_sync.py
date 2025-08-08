from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_prompts_by_id_sync_body import PostApiPromptsByIdSyncBody
from ...models.post_api_prompts_by_id_sync_response_200 import PostApiPromptsByIdSyncResponse200
from ...models.post_api_prompts_by_id_sync_response_400 import PostApiPromptsByIdSyncResponse400
from ...models.post_api_prompts_by_id_sync_response_401 import PostApiPromptsByIdSyncResponse401
from ...models.post_api_prompts_by_id_sync_response_500 import PostApiPromptsByIdSyncResponse500
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: PostApiPromptsByIdSyncBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/prompts/{id}/sync",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        PostApiPromptsByIdSyncResponse200,
        PostApiPromptsByIdSyncResponse400,
        PostApiPromptsByIdSyncResponse401,
        PostApiPromptsByIdSyncResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = PostApiPromptsByIdSyncResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = PostApiPromptsByIdSyncResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = PostApiPromptsByIdSyncResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 500:
        response_500 = PostApiPromptsByIdSyncResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        PostApiPromptsByIdSyncResponse200,
        PostApiPromptsByIdSyncResponse400,
        PostApiPromptsByIdSyncResponse401,
        PostApiPromptsByIdSyncResponse500,
    ]
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
    client: Union[AuthenticatedClient, Client],
    body: PostApiPromptsByIdSyncBody,
) -> Response[
    Union[
        PostApiPromptsByIdSyncResponse200,
        PostApiPromptsByIdSyncResponse400,
        PostApiPromptsByIdSyncResponse401,
        PostApiPromptsByIdSyncResponse500,
    ]
]:
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PostApiPromptsByIdSyncResponse200, PostApiPromptsByIdSyncResponse400, PostApiPromptsByIdSyncResponse401, PostApiPromptsByIdSyncResponse500]]
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
    client: Union[AuthenticatedClient, Client],
    body: PostApiPromptsByIdSyncBody,
) -> Optional[
    Union[
        PostApiPromptsByIdSyncResponse200,
        PostApiPromptsByIdSyncResponse400,
        PostApiPromptsByIdSyncResponse401,
        PostApiPromptsByIdSyncResponse500,
    ]
]:
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PostApiPromptsByIdSyncResponse200, PostApiPromptsByIdSyncResponse400, PostApiPromptsByIdSyncResponse401, PostApiPromptsByIdSyncResponse500]
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PostApiPromptsByIdSyncBody,
) -> Response[
    Union[
        PostApiPromptsByIdSyncResponse200,
        PostApiPromptsByIdSyncResponse400,
        PostApiPromptsByIdSyncResponse401,
        PostApiPromptsByIdSyncResponse500,
    ]
]:
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PostApiPromptsByIdSyncResponse200, PostApiPromptsByIdSyncResponse400, PostApiPromptsByIdSyncResponse401, PostApiPromptsByIdSyncResponse500]]
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
    client: Union[AuthenticatedClient, Client],
    body: PostApiPromptsByIdSyncBody,
) -> Optional[
    Union[
        PostApiPromptsByIdSyncResponse200,
        PostApiPromptsByIdSyncResponse400,
        PostApiPromptsByIdSyncResponse401,
        PostApiPromptsByIdSyncResponse500,
    ]
]:
    """Sync/upsert a prompt with local content

    Args:
        id (str):
        body (PostApiPromptsByIdSyncBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PostApiPromptsByIdSyncResponse200, PostApiPromptsByIdSyncResponse400, PostApiPromptsByIdSyncResponse401, PostApiPromptsByIdSyncResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
