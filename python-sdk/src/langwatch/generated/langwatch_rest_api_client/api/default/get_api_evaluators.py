from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_evaluators_response_200_item import GetApiEvaluatorsResponse200Item
from ...models.get_api_evaluators_response_400 import GetApiEvaluatorsResponse400
from ...models.get_api_evaluators_response_401 import GetApiEvaluatorsResponse401
from ...models.get_api_evaluators_response_422 import GetApiEvaluatorsResponse422
from ...models.get_api_evaluators_response_500 import GetApiEvaluatorsResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/evaluators",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiEvaluatorsResponse400
    | GetApiEvaluatorsResponse401
    | GetApiEvaluatorsResponse422
    | GetApiEvaluatorsResponse500
    | list[GetApiEvaluatorsResponse200Item]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiEvaluatorsResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = GetApiEvaluatorsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiEvaluatorsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiEvaluatorsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiEvaluatorsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiEvaluatorsResponse400
    | GetApiEvaluatorsResponse401
    | GetApiEvaluatorsResponse422
    | GetApiEvaluatorsResponse500
    | list[GetApiEvaluatorsResponse200Item]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiEvaluatorsResponse400
    | GetApiEvaluatorsResponse401
    | GetApiEvaluatorsResponse422
    | GetApiEvaluatorsResponse500
    | list[GetApiEvaluatorsResponse200Item]
]:
    """Get all evaluators for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiEvaluatorsResponse400 | GetApiEvaluatorsResponse401 | GetApiEvaluatorsResponse422 | GetApiEvaluatorsResponse500 | list[GetApiEvaluatorsResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiEvaluatorsResponse400
    | GetApiEvaluatorsResponse401
    | GetApiEvaluatorsResponse422
    | GetApiEvaluatorsResponse500
    | list[GetApiEvaluatorsResponse200Item]
    | None
):
    """Get all evaluators for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiEvaluatorsResponse400 | GetApiEvaluatorsResponse401 | GetApiEvaluatorsResponse422 | GetApiEvaluatorsResponse500 | list[GetApiEvaluatorsResponse200Item]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiEvaluatorsResponse400
    | GetApiEvaluatorsResponse401
    | GetApiEvaluatorsResponse422
    | GetApiEvaluatorsResponse500
    | list[GetApiEvaluatorsResponse200Item]
]:
    """Get all evaluators for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiEvaluatorsResponse400 | GetApiEvaluatorsResponse401 | GetApiEvaluatorsResponse422 | GetApiEvaluatorsResponse500 | list[GetApiEvaluatorsResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiEvaluatorsResponse400
    | GetApiEvaluatorsResponse401
    | GetApiEvaluatorsResponse422
    | GetApiEvaluatorsResponse500
    | list[GetApiEvaluatorsResponse200Item]
    | None
):
    """Get all evaluators for a project

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiEvaluatorsResponse400 | GetApiEvaluatorsResponse401 | GetApiEvaluatorsResponse422 | GetApiEvaluatorsResponse500 | list[GetApiEvaluatorsResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
