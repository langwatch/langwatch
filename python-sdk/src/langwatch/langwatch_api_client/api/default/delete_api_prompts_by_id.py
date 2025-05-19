from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_prompts_by_id_response_200 import DeleteApiPromptsByIdResponse200
from ...models.delete_api_prompts_by_id_response_400 import DeleteApiPromptsByIdResponse400
from ...models.delete_api_prompts_by_id_response_401 import DeleteApiPromptsByIdResponse401
from ...models.delete_api_prompts_by_id_response_404 import DeleteApiPromptsByIdResponse404
from ...models.delete_api_prompts_by_id_response_500 import DeleteApiPromptsByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": f"/api/prompts/{id}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        DeleteApiPromptsByIdResponse200,
        DeleteApiPromptsByIdResponse400,
        DeleteApiPromptsByIdResponse401,
        DeleteApiPromptsByIdResponse404,
        DeleteApiPromptsByIdResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = DeleteApiPromptsByIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = DeleteApiPromptsByIdResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = DeleteApiPromptsByIdResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = DeleteApiPromptsByIdResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 500:
        response_500 = DeleteApiPromptsByIdResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        DeleteApiPromptsByIdResponse200,
        DeleteApiPromptsByIdResponse400,
        DeleteApiPromptsByIdResponse401,
        DeleteApiPromptsByIdResponse404,
        DeleteApiPromptsByIdResponse500,
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
) -> Response[
    Union[
        DeleteApiPromptsByIdResponse200,
        DeleteApiPromptsByIdResponse400,
        DeleteApiPromptsByIdResponse401,
        DeleteApiPromptsByIdResponse404,
        DeleteApiPromptsByIdResponse500,
    ]
]:
    """Delete a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[DeleteApiPromptsByIdResponse200, DeleteApiPromptsByIdResponse400, DeleteApiPromptsByIdResponse401, DeleteApiPromptsByIdResponse404, DeleteApiPromptsByIdResponse500]]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        DeleteApiPromptsByIdResponse200,
        DeleteApiPromptsByIdResponse400,
        DeleteApiPromptsByIdResponse401,
        DeleteApiPromptsByIdResponse404,
        DeleteApiPromptsByIdResponse500,
    ]
]:
    """Delete a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[DeleteApiPromptsByIdResponse200, DeleteApiPromptsByIdResponse400, DeleteApiPromptsByIdResponse401, DeleteApiPromptsByIdResponse404, DeleteApiPromptsByIdResponse500]
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        DeleteApiPromptsByIdResponse200,
        DeleteApiPromptsByIdResponse400,
        DeleteApiPromptsByIdResponse401,
        DeleteApiPromptsByIdResponse404,
        DeleteApiPromptsByIdResponse500,
    ]
]:
    """Delete a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[DeleteApiPromptsByIdResponse200, DeleteApiPromptsByIdResponse400, DeleteApiPromptsByIdResponse401, DeleteApiPromptsByIdResponse404, DeleteApiPromptsByIdResponse500]]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        DeleteApiPromptsByIdResponse200,
        DeleteApiPromptsByIdResponse400,
        DeleteApiPromptsByIdResponse401,
        DeleteApiPromptsByIdResponse404,
        DeleteApiPromptsByIdResponse500,
    ]
]:
    """Delete a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[DeleteApiPromptsByIdResponse200, DeleteApiPromptsByIdResponse400, DeleteApiPromptsByIdResponse401, DeleteApiPromptsByIdResponse404, DeleteApiPromptsByIdResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
