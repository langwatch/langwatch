from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_suites_by_id_response_200 import GetApiSuitesByIdResponse200
from ...models.get_api_suites_by_id_response_400 import GetApiSuitesByIdResponse400
from ...models.get_api_suites_by_id_response_401 import GetApiSuitesByIdResponse401
from ...models.get_api_suites_by_id_response_404 import GetApiSuitesByIdResponse404
from ...models.get_api_suites_by_id_response_422 import GetApiSuitesByIdResponse422
from ...models.get_api_suites_by_id_response_500 import GetApiSuitesByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/suites/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSuitesByIdResponse200
    | GetApiSuitesByIdResponse400
    | GetApiSuitesByIdResponse401
    | GetApiSuitesByIdResponse404
    | GetApiSuitesByIdResponse422
    | GetApiSuitesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiSuitesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSuitesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSuitesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiSuitesByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiSuitesByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSuitesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSuitesByIdResponse200
    | GetApiSuitesByIdResponse400
    | GetApiSuitesByIdResponse401
    | GetApiSuitesByIdResponse404
    | GetApiSuitesByIdResponse422
    | GetApiSuitesByIdResponse500
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
    GetApiSuitesByIdResponse200
    | GetApiSuitesByIdResponse400
    | GetApiSuitesByIdResponse401
    | GetApiSuitesByIdResponse404
    | GetApiSuitesByIdResponse422
    | GetApiSuitesByIdResponse500
]:
    """Get a suite (run plan) by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse400 | GetApiSuitesByIdResponse401 | GetApiSuitesByIdResponse404 | GetApiSuitesByIdResponse422 | GetApiSuitesByIdResponse500]
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
    GetApiSuitesByIdResponse200
    | GetApiSuitesByIdResponse400
    | GetApiSuitesByIdResponse401
    | GetApiSuitesByIdResponse404
    | GetApiSuitesByIdResponse422
    | GetApiSuitesByIdResponse500
    | None
):
    """Get a suite (run plan) by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse400 | GetApiSuitesByIdResponse401 | GetApiSuitesByIdResponse404 | GetApiSuitesByIdResponse422 | GetApiSuitesByIdResponse500
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
    GetApiSuitesByIdResponse200
    | GetApiSuitesByIdResponse400
    | GetApiSuitesByIdResponse401
    | GetApiSuitesByIdResponse404
    | GetApiSuitesByIdResponse422
    | GetApiSuitesByIdResponse500
]:
    """Get a suite (run plan) by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse400 | GetApiSuitesByIdResponse401 | GetApiSuitesByIdResponse404 | GetApiSuitesByIdResponse422 | GetApiSuitesByIdResponse500]
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
    GetApiSuitesByIdResponse200
    | GetApiSuitesByIdResponse400
    | GetApiSuitesByIdResponse401
    | GetApiSuitesByIdResponse404
    | GetApiSuitesByIdResponse422
    | GetApiSuitesByIdResponse500
    | None
):
    """Get a suite (run plan) by its ID

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse400 | GetApiSuitesByIdResponse401 | GetApiSuitesByIdResponse404 | GetApiSuitesByIdResponse422 | GetApiSuitesByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
