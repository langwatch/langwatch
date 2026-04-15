from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_graphs_by_id_body import PatchApiGraphsByIdBody
from ...models.patch_api_graphs_by_id_response_200 import PatchApiGraphsByIdResponse200
from ...models.patch_api_graphs_by_id_response_400 import PatchApiGraphsByIdResponse400
from ...models.patch_api_graphs_by_id_response_401 import PatchApiGraphsByIdResponse401
from ...models.patch_api_graphs_by_id_response_404 import PatchApiGraphsByIdResponse404
from ...models.patch_api_graphs_by_id_response_422 import PatchApiGraphsByIdResponse422
from ...models.patch_api_graphs_by_id_response_500 import PatchApiGraphsByIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PatchApiGraphsByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/graphs/{id}".format(
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
    PatchApiGraphsByIdResponse200
    | PatchApiGraphsByIdResponse400
    | PatchApiGraphsByIdResponse401
    | PatchApiGraphsByIdResponse404
    | PatchApiGraphsByIdResponse422
    | PatchApiGraphsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiGraphsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiGraphsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiGraphsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PatchApiGraphsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PatchApiGraphsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiGraphsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiGraphsByIdResponse200
    | PatchApiGraphsByIdResponse400
    | PatchApiGraphsByIdResponse401
    | PatchApiGraphsByIdResponse404
    | PatchApiGraphsByIdResponse422
    | PatchApiGraphsByIdResponse500
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
    body: PatchApiGraphsByIdBody | Unset = UNSET,
) -> Response[
    PatchApiGraphsByIdResponse200
    | PatchApiGraphsByIdResponse400
    | PatchApiGraphsByIdResponse401
    | PatchApiGraphsByIdResponse404
    | PatchApiGraphsByIdResponse422
    | PatchApiGraphsByIdResponse500
]:
    """Update a custom graph's name, definition, or filters

    Args:
        id (str):
        body (PatchApiGraphsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGraphsByIdResponse200 | PatchApiGraphsByIdResponse400 | PatchApiGraphsByIdResponse401 | PatchApiGraphsByIdResponse404 | PatchApiGraphsByIdResponse422 | PatchApiGraphsByIdResponse500]
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
    body: PatchApiGraphsByIdBody | Unset = UNSET,
) -> (
    PatchApiGraphsByIdResponse200
    | PatchApiGraphsByIdResponse400
    | PatchApiGraphsByIdResponse401
    | PatchApiGraphsByIdResponse404
    | PatchApiGraphsByIdResponse422
    | PatchApiGraphsByIdResponse500
    | None
):
    """Update a custom graph's name, definition, or filters

    Args:
        id (str):
        body (PatchApiGraphsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGraphsByIdResponse200 | PatchApiGraphsByIdResponse400 | PatchApiGraphsByIdResponse401 | PatchApiGraphsByIdResponse404 | PatchApiGraphsByIdResponse422 | PatchApiGraphsByIdResponse500
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
    body: PatchApiGraphsByIdBody | Unset = UNSET,
) -> Response[
    PatchApiGraphsByIdResponse200
    | PatchApiGraphsByIdResponse400
    | PatchApiGraphsByIdResponse401
    | PatchApiGraphsByIdResponse404
    | PatchApiGraphsByIdResponse422
    | PatchApiGraphsByIdResponse500
]:
    """Update a custom graph's name, definition, or filters

    Args:
        id (str):
        body (PatchApiGraphsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGraphsByIdResponse200 | PatchApiGraphsByIdResponse400 | PatchApiGraphsByIdResponse401 | PatchApiGraphsByIdResponse404 | PatchApiGraphsByIdResponse422 | PatchApiGraphsByIdResponse500]
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
    body: PatchApiGraphsByIdBody | Unset = UNSET,
) -> (
    PatchApiGraphsByIdResponse200
    | PatchApiGraphsByIdResponse400
    | PatchApiGraphsByIdResponse401
    | PatchApiGraphsByIdResponse404
    | PatchApiGraphsByIdResponse422
    | PatchApiGraphsByIdResponse500
    | None
):
    """Update a custom graph's name, definition, or filters

    Args:
        id (str):
        body (PatchApiGraphsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGraphsByIdResponse200 | PatchApiGraphsByIdResponse400 | PatchApiGraphsByIdResponse401 | PatchApiGraphsByIdResponse404 | PatchApiGraphsByIdResponse422 | PatchApiGraphsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
