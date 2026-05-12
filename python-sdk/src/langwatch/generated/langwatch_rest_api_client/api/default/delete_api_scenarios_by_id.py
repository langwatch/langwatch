from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_scenarios_by_id_response_200 import DeleteApiScenariosByIdResponse200
from ...models.delete_api_scenarios_by_id_response_400 import DeleteApiScenariosByIdResponse400
from ...models.delete_api_scenarios_by_id_response_401 import DeleteApiScenariosByIdResponse401
from ...models.delete_api_scenarios_by_id_response_404 import DeleteApiScenariosByIdResponse404
from ...models.delete_api_scenarios_by_id_response_422 import DeleteApiScenariosByIdResponse422
from ...models.delete_api_scenarios_by_id_response_500 import DeleteApiScenariosByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/scenarios/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiScenariosByIdResponse200
    | DeleteApiScenariosByIdResponse400
    | DeleteApiScenariosByIdResponse401
    | DeleteApiScenariosByIdResponse404
    | DeleteApiScenariosByIdResponse422
    | DeleteApiScenariosByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiScenariosByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiScenariosByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiScenariosByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = DeleteApiScenariosByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = DeleteApiScenariosByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = DeleteApiScenariosByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiScenariosByIdResponse200
    | DeleteApiScenariosByIdResponse400
    | DeleteApiScenariosByIdResponse401
    | DeleteApiScenariosByIdResponse404
    | DeleteApiScenariosByIdResponse422
    | DeleteApiScenariosByIdResponse500
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
    DeleteApiScenariosByIdResponse200
    | DeleteApiScenariosByIdResponse400
    | DeleteApiScenariosByIdResponse401
    | DeleteApiScenariosByIdResponse404
    | DeleteApiScenariosByIdResponse422
    | DeleteApiScenariosByIdResponse500
]:
    """Archive (soft-delete) a scenario

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiScenariosByIdResponse200 | DeleteApiScenariosByIdResponse400 | DeleteApiScenariosByIdResponse401 | DeleteApiScenariosByIdResponse404 | DeleteApiScenariosByIdResponse422 | DeleteApiScenariosByIdResponse500]
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
    DeleteApiScenariosByIdResponse200
    | DeleteApiScenariosByIdResponse400
    | DeleteApiScenariosByIdResponse401
    | DeleteApiScenariosByIdResponse404
    | DeleteApiScenariosByIdResponse422
    | DeleteApiScenariosByIdResponse500
    | None
):
    """Archive (soft-delete) a scenario

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiScenariosByIdResponse200 | DeleteApiScenariosByIdResponse400 | DeleteApiScenariosByIdResponse401 | DeleteApiScenariosByIdResponse404 | DeleteApiScenariosByIdResponse422 | DeleteApiScenariosByIdResponse500
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
    DeleteApiScenariosByIdResponse200
    | DeleteApiScenariosByIdResponse400
    | DeleteApiScenariosByIdResponse401
    | DeleteApiScenariosByIdResponse404
    | DeleteApiScenariosByIdResponse422
    | DeleteApiScenariosByIdResponse500
]:
    """Archive (soft-delete) a scenario

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiScenariosByIdResponse200 | DeleteApiScenariosByIdResponse400 | DeleteApiScenariosByIdResponse401 | DeleteApiScenariosByIdResponse404 | DeleteApiScenariosByIdResponse422 | DeleteApiScenariosByIdResponse500]
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
    DeleteApiScenariosByIdResponse200
    | DeleteApiScenariosByIdResponse400
    | DeleteApiScenariosByIdResponse401
    | DeleteApiScenariosByIdResponse404
    | DeleteApiScenariosByIdResponse422
    | DeleteApiScenariosByIdResponse500
    | None
):
    """Archive (soft-delete) a scenario

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiScenariosByIdResponse200 | DeleteApiScenariosByIdResponse400 | DeleteApiScenariosByIdResponse401 | DeleteApiScenariosByIdResponse404 | DeleteApiScenariosByIdResponse422 | DeleteApiScenariosByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
