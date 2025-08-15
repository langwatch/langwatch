from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_prompts_by_id_versions_response_200_item import GetApiPromptsByIdVersionsResponse200Item
from ...models.get_api_prompts_by_id_versions_response_400 import GetApiPromptsByIdVersionsResponse400
from ...models.get_api_prompts_by_id_versions_response_401 import GetApiPromptsByIdVersionsResponse401
from ...models.get_api_prompts_by_id_versions_response_404 import GetApiPromptsByIdVersionsResponse404
from ...models.get_api_prompts_by_id_versions_response_500 import GetApiPromptsByIdVersionsResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/prompts/{id}/versions",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
        list["GetApiPromptsByIdVersionsResponse200Item"],
    ]
]:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiPromptsByIdVersionsResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200
    if response.status_code == 400:
        response_400 = GetApiPromptsByIdVersionsResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = GetApiPromptsByIdVersionsResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = GetApiPromptsByIdVersionsResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 500:
        response_500 = GetApiPromptsByIdVersionsResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
        list["GetApiPromptsByIdVersionsResponse200Item"],
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
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
        list["GetApiPromptsByIdVersionsResponse200Item"],
    ]
]:
    """Get all versions for a prompt. Does not include base prompt data, only versioned data.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500, list['GetApiPromptsByIdVersionsResponse200Item']]]
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
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
        list["GetApiPromptsByIdVersionsResponse200Item"],
    ]
]:
    """Get all versions for a prompt. Does not include base prompt data, only versioned data.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500, list['GetApiPromptsByIdVersionsResponse200Item']]
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
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
        list["GetApiPromptsByIdVersionsResponse200Item"],
    ]
]:
    """Get all versions for a prompt. Does not include base prompt data, only versioned data.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500, list['GetApiPromptsByIdVersionsResponse200Item']]]
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
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
        list["GetApiPromptsByIdVersionsResponse200Item"],
    ]
]:
    """Get all versions for a prompt. Does not include base prompt data, only versioned data.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500, list['GetApiPromptsByIdVersionsResponse200Item']]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
