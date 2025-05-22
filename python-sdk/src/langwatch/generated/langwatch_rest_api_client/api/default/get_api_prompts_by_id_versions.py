from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_prompts_by_id_versions_response_200 import GetApiPromptsByIdVersionsResponse200
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
        GetApiPromptsByIdVersionsResponse200,
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = GetApiPromptsByIdVersionsResponse200.from_dict(response.json())

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
        GetApiPromptsByIdVersionsResponse200,
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
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
        GetApiPromptsByIdVersionsResponse200,
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
    ]
]:
    """Get all versions for a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiPromptsByIdVersionsResponse200, GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500]]
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
        GetApiPromptsByIdVersionsResponse200,
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
    ]
]:
    """Get all versions for a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiPromptsByIdVersionsResponse200, GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500]
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
        GetApiPromptsByIdVersionsResponse200,
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
    ]
]:
    """Get all versions for a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiPromptsByIdVersionsResponse200, GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500]]
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
        GetApiPromptsByIdVersionsResponse200,
        GetApiPromptsByIdVersionsResponse400,
        GetApiPromptsByIdVersionsResponse401,
        GetApiPromptsByIdVersionsResponse404,
        GetApiPromptsByIdVersionsResponse500,
    ]
]:
    """Get all versions for a prompt

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiPromptsByIdVersionsResponse200, GetApiPromptsByIdVersionsResponse400, GetApiPromptsByIdVersionsResponse401, GetApiPromptsByIdVersionsResponse404, GetApiPromptsByIdVersionsResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
