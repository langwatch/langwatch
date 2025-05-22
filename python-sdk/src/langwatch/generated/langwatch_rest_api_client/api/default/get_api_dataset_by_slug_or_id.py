from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_dataset_by_slug_or_id_response_200 import GetApiDatasetBySlugOrIdResponse200
from ...models.get_api_dataset_by_slug_or_id_response_400 import GetApiDatasetBySlugOrIdResponse400
from ...models.get_api_dataset_by_slug_or_id_response_401 import GetApiDatasetBySlugOrIdResponse401
from ...models.get_api_dataset_by_slug_or_id_response_404 import GetApiDatasetBySlugOrIdResponse404
from ...models.get_api_dataset_by_slug_or_id_response_422 import GetApiDatasetBySlugOrIdResponse422
from ...models.get_api_dataset_by_slug_or_id_response_500 import GetApiDatasetBySlugOrIdResponse500
from ...types import Response


def _get_kwargs(
    slug_or_id: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/dataset/{slug_or_id}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        GetApiDatasetBySlugOrIdResponse200,
        GetApiDatasetBySlugOrIdResponse400,
        GetApiDatasetBySlugOrIdResponse401,
        GetApiDatasetBySlugOrIdResponse404,
        GetApiDatasetBySlugOrIdResponse422,
        GetApiDatasetBySlugOrIdResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = GetApiDatasetBySlugOrIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = GetApiDatasetBySlugOrIdResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = GetApiDatasetBySlugOrIdResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = GetApiDatasetBySlugOrIdResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 422:
        response_422 = GetApiDatasetBySlugOrIdResponse422.from_dict(response.json())

        return response_422
    if response.status_code == 500:
        response_500 = GetApiDatasetBySlugOrIdResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        GetApiDatasetBySlugOrIdResponse200,
        GetApiDatasetBySlugOrIdResponse400,
        GetApiDatasetBySlugOrIdResponse401,
        GetApiDatasetBySlugOrIdResponse404,
        GetApiDatasetBySlugOrIdResponse422,
        GetApiDatasetBySlugOrIdResponse500,
    ]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    slug_or_id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        GetApiDatasetBySlugOrIdResponse200,
        GetApiDatasetBySlugOrIdResponse400,
        GetApiDatasetBySlugOrIdResponse401,
        GetApiDatasetBySlugOrIdResponse404,
        GetApiDatasetBySlugOrIdResponse422,
        GetApiDatasetBySlugOrIdResponse500,
    ]
]:
    """Get a dataset by its slug or id.

    Args:
        slug_or_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiDatasetBySlugOrIdResponse200, GetApiDatasetBySlugOrIdResponse400, GetApiDatasetBySlugOrIdResponse401, GetApiDatasetBySlugOrIdResponse404, GetApiDatasetBySlugOrIdResponse422, GetApiDatasetBySlugOrIdResponse500]]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug_or_id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        GetApiDatasetBySlugOrIdResponse200,
        GetApiDatasetBySlugOrIdResponse400,
        GetApiDatasetBySlugOrIdResponse401,
        GetApiDatasetBySlugOrIdResponse404,
        GetApiDatasetBySlugOrIdResponse422,
        GetApiDatasetBySlugOrIdResponse500,
    ]
]:
    """Get a dataset by its slug or id.

    Args:
        slug_or_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiDatasetBySlugOrIdResponse200, GetApiDatasetBySlugOrIdResponse400, GetApiDatasetBySlugOrIdResponse401, GetApiDatasetBySlugOrIdResponse404, GetApiDatasetBySlugOrIdResponse422, GetApiDatasetBySlugOrIdResponse500]
    """

    return sync_detailed(
        slug_or_id=slug_or_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    slug_or_id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        GetApiDatasetBySlugOrIdResponse200,
        GetApiDatasetBySlugOrIdResponse400,
        GetApiDatasetBySlugOrIdResponse401,
        GetApiDatasetBySlugOrIdResponse404,
        GetApiDatasetBySlugOrIdResponse422,
        GetApiDatasetBySlugOrIdResponse500,
    ]
]:
    """Get a dataset by its slug or id.

    Args:
        slug_or_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiDatasetBySlugOrIdResponse200, GetApiDatasetBySlugOrIdResponse400, GetApiDatasetBySlugOrIdResponse401, GetApiDatasetBySlugOrIdResponse404, GetApiDatasetBySlugOrIdResponse422, GetApiDatasetBySlugOrIdResponse500]]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug_or_id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        GetApiDatasetBySlugOrIdResponse200,
        GetApiDatasetBySlugOrIdResponse400,
        GetApiDatasetBySlugOrIdResponse401,
        GetApiDatasetBySlugOrIdResponse404,
        GetApiDatasetBySlugOrIdResponse422,
        GetApiDatasetBySlugOrIdResponse500,
    ]
]:
    """Get a dataset by its slug or id.

    Args:
        slug_or_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiDatasetBySlugOrIdResponse200, GetApiDatasetBySlugOrIdResponse400, GetApiDatasetBySlugOrIdResponse401, GetApiDatasetBySlugOrIdResponse404, GetApiDatasetBySlugOrIdResponse422, GetApiDatasetBySlugOrIdResponse500]
    """

    return (
        await asyncio_detailed(
            slug_or_id=slug_or_id,
            client=client,
        )
    ).parsed
