from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_prompts_by_id_response_200 import GetApiPromptsByIdResponse200
from ...models.get_api_prompts_by_id_response_400 import GetApiPromptsByIdResponse400
from ...models.get_api_prompts_by_id_response_401 import GetApiPromptsByIdResponse401
from ...models.get_api_prompts_by_id_response_404 import GetApiPromptsByIdResponse404
from ...models.get_api_prompts_by_id_response_500 import GetApiPromptsByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/prompts/{id}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        GetApiPromptsByIdResponse200,
        GetApiPromptsByIdResponse400,
        GetApiPromptsByIdResponse401,
        GetApiPromptsByIdResponse404,
        GetApiPromptsByIdResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = GetApiPromptsByIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = GetApiPromptsByIdResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = GetApiPromptsByIdResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = GetApiPromptsByIdResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 500:
        response_500 = GetApiPromptsByIdResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        GetApiPromptsByIdResponse200,
        GetApiPromptsByIdResponse400,
        GetApiPromptsByIdResponse401,
        GetApiPromptsByIdResponse404,
        GetApiPromptsByIdResponse500,
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
        GetApiPromptsByIdResponse200,
        GetApiPromptsByIdResponse400,
        GetApiPromptsByIdResponse401,
        GetApiPromptsByIdResponse404,
        GetApiPromptsByIdResponse500,
    ]
]:
    """Get a specific prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiPromptsByIdResponse200, GetApiPromptsByIdResponse400, GetApiPromptsByIdResponse401, GetApiPromptsByIdResponse404, GetApiPromptsByIdResponse500]]
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
        GetApiPromptsByIdResponse200,
        GetApiPromptsByIdResponse400,
        GetApiPromptsByIdResponse401,
        GetApiPromptsByIdResponse404,
        GetApiPromptsByIdResponse500,
    ]
]:
    """Get a specific prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiPromptsByIdResponse200, GetApiPromptsByIdResponse400, GetApiPromptsByIdResponse401, GetApiPromptsByIdResponse404, GetApiPromptsByIdResponse500]
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
        GetApiPromptsByIdResponse200,
        GetApiPromptsByIdResponse400,
        GetApiPromptsByIdResponse401,
        GetApiPromptsByIdResponse404,
        GetApiPromptsByIdResponse500,
    ]
]:
    """Get a specific prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiPromptsByIdResponse200, GetApiPromptsByIdResponse400, GetApiPromptsByIdResponse401, GetApiPromptsByIdResponse404, GetApiPromptsByIdResponse500]]
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
        GetApiPromptsByIdResponse200,
        GetApiPromptsByIdResponse400,
        GetApiPromptsByIdResponse401,
        GetApiPromptsByIdResponse404,
        GetApiPromptsByIdResponse500,
    ]
]:
    """Get a specific prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiPromptsByIdResponse200, GetApiPromptsByIdResponse400, GetApiPromptsByIdResponse401, GetApiPromptsByIdResponse404, GetApiPromptsByIdResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
