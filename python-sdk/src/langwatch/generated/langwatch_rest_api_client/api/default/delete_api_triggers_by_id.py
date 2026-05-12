from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_triggers_by_id_response_200 import DeleteApiTriggersByIdResponse200
from ...models.delete_api_triggers_by_id_response_400 import DeleteApiTriggersByIdResponse400
from ...models.delete_api_triggers_by_id_response_401 import DeleteApiTriggersByIdResponse401
from ...models.delete_api_triggers_by_id_response_404 import DeleteApiTriggersByIdResponse404
from ...models.delete_api_triggers_by_id_response_422 import DeleteApiTriggersByIdResponse422
from ...models.delete_api_triggers_by_id_response_500 import DeleteApiTriggersByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/triggers/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiTriggersByIdResponse200
    | DeleteApiTriggersByIdResponse400
    | DeleteApiTriggersByIdResponse401
    | DeleteApiTriggersByIdResponse404
    | DeleteApiTriggersByIdResponse422
    | DeleteApiTriggersByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiTriggersByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiTriggersByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiTriggersByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = DeleteApiTriggersByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = DeleteApiTriggersByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = DeleteApiTriggersByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiTriggersByIdResponse200
    | DeleteApiTriggersByIdResponse400
    | DeleteApiTriggersByIdResponse401
    | DeleteApiTriggersByIdResponse404
    | DeleteApiTriggersByIdResponse422
    | DeleteApiTriggersByIdResponse500
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
) -> Response[
    DeleteApiTriggersByIdResponse200
    | DeleteApiTriggersByIdResponse400
    | DeleteApiTriggersByIdResponse401
    | DeleteApiTriggersByIdResponse404
    | DeleteApiTriggersByIdResponse422
    | DeleteApiTriggersByIdResponse500
]:
    """Delete (soft-delete) a trigger

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiTriggersByIdResponse200 | DeleteApiTriggersByIdResponse400 | DeleteApiTriggersByIdResponse401 | DeleteApiTriggersByIdResponse404 | DeleteApiTriggersByIdResponse422 | DeleteApiTriggersByIdResponse500]
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
    client: AuthenticatedClient | Client,
) -> (
    DeleteApiTriggersByIdResponse200
    | DeleteApiTriggersByIdResponse400
    | DeleteApiTriggersByIdResponse401
    | DeleteApiTriggersByIdResponse404
    | DeleteApiTriggersByIdResponse422
    | DeleteApiTriggersByIdResponse500
    | None
):
    """Delete (soft-delete) a trigger

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiTriggersByIdResponse200 | DeleteApiTriggersByIdResponse400 | DeleteApiTriggersByIdResponse401 | DeleteApiTriggersByIdResponse404 | DeleteApiTriggersByIdResponse422 | DeleteApiTriggersByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    DeleteApiTriggersByIdResponse200
    | DeleteApiTriggersByIdResponse400
    | DeleteApiTriggersByIdResponse401
    | DeleteApiTriggersByIdResponse404
    | DeleteApiTriggersByIdResponse422
    | DeleteApiTriggersByIdResponse500
]:
    """Delete (soft-delete) a trigger

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiTriggersByIdResponse200 | DeleteApiTriggersByIdResponse400 | DeleteApiTriggersByIdResponse401 | DeleteApiTriggersByIdResponse404 | DeleteApiTriggersByIdResponse422 | DeleteApiTriggersByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    DeleteApiTriggersByIdResponse200
    | DeleteApiTriggersByIdResponse400
    | DeleteApiTriggersByIdResponse401
    | DeleteApiTriggersByIdResponse404
    | DeleteApiTriggersByIdResponse422
    | DeleteApiTriggersByIdResponse500
    | None
):
    """Delete (soft-delete) a trigger

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiTriggersByIdResponse200 | DeleteApiTriggersByIdResponse400 | DeleteApiTriggersByIdResponse401 | DeleteApiTriggersByIdResponse404 | DeleteApiTriggersByIdResponse422 | DeleteApiTriggersByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
