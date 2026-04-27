from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_triggers_by_id_body import PatchApiTriggersByIdBody
from ...models.patch_api_triggers_by_id_response_200 import PatchApiTriggersByIdResponse200
from ...models.patch_api_triggers_by_id_response_400 import PatchApiTriggersByIdResponse400
from ...models.patch_api_triggers_by_id_response_401 import PatchApiTriggersByIdResponse401
from ...models.patch_api_triggers_by_id_response_404 import PatchApiTriggersByIdResponse404
from ...models.patch_api_triggers_by_id_response_422 import PatchApiTriggersByIdResponse422
from ...models.patch_api_triggers_by_id_response_500 import PatchApiTriggersByIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/triggers/{id}".format(
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
    PatchApiTriggersByIdResponse200
    | PatchApiTriggersByIdResponse400
    | PatchApiTriggersByIdResponse401
    | PatchApiTriggersByIdResponse404
    | PatchApiTriggersByIdResponse422
    | PatchApiTriggersByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiTriggersByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiTriggersByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiTriggersByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PatchApiTriggersByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PatchApiTriggersByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiTriggersByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiTriggersByIdResponse200
    | PatchApiTriggersByIdResponse400
    | PatchApiTriggersByIdResponse401
    | PatchApiTriggersByIdResponse404
    | PatchApiTriggersByIdResponse422
    | PatchApiTriggersByIdResponse500
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
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> Response[
    PatchApiTriggersByIdResponse200
    | PatchApiTriggersByIdResponse400
    | PatchApiTriggersByIdResponse401
    | PatchApiTriggersByIdResponse404
    | PatchApiTriggersByIdResponse422
    | PatchApiTriggersByIdResponse500
]:
    """Update a trigger (name, active state, message, filters)

    Args:
        id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse400 | PatchApiTriggersByIdResponse401 | PatchApiTriggersByIdResponse404 | PatchApiTriggersByIdResponse422 | PatchApiTriggersByIdResponse500]
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
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> (
    PatchApiTriggersByIdResponse200
    | PatchApiTriggersByIdResponse400
    | PatchApiTriggersByIdResponse401
    | PatchApiTriggersByIdResponse404
    | PatchApiTriggersByIdResponse422
    | PatchApiTriggersByIdResponse500
    | None
):
    """Update a trigger (name, active state, message, filters)

    Args:
        id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse400 | PatchApiTriggersByIdResponse401 | PatchApiTriggersByIdResponse404 | PatchApiTriggersByIdResponse422 | PatchApiTriggersByIdResponse500
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
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> Response[
    PatchApiTriggersByIdResponse200
    | PatchApiTriggersByIdResponse400
    | PatchApiTriggersByIdResponse401
    | PatchApiTriggersByIdResponse404
    | PatchApiTriggersByIdResponse422
    | PatchApiTriggersByIdResponse500
]:
    """Update a trigger (name, active state, message, filters)

    Args:
        id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse400 | PatchApiTriggersByIdResponse401 | PatchApiTriggersByIdResponse404 | PatchApiTriggersByIdResponse422 | PatchApiTriggersByIdResponse500]
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
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> (
    PatchApiTriggersByIdResponse200
    | PatchApiTriggersByIdResponse400
    | PatchApiTriggersByIdResponse401
    | PatchApiTriggersByIdResponse404
    | PatchApiTriggersByIdResponse422
    | PatchApiTriggersByIdResponse500
    | None
):
    """Update a trigger (name, active state, message, filters)

    Args:
        id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse400 | PatchApiTriggersByIdResponse401 | PatchApiTriggersByIdResponse404 | PatchApiTriggersByIdResponse422 | PatchApiTriggersByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
