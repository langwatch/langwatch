from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_scenarios_by_id_body import PutApiScenariosByIdBody
from ...models.put_api_scenarios_by_id_response_200 import PutApiScenariosByIdResponse200
from ...models.put_api_scenarios_by_id_response_400 import PutApiScenariosByIdResponse400
from ...models.put_api_scenarios_by_id_response_401 import PutApiScenariosByIdResponse401
from ...models.put_api_scenarios_by_id_response_404 import PutApiScenariosByIdResponse404
from ...models.put_api_scenarios_by_id_response_422 import PutApiScenariosByIdResponse422
from ...models.put_api_scenarios_by_id_response_500 import PutApiScenariosByIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PutApiScenariosByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/scenarios/{id}".format(
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
    PutApiScenariosByIdResponse200
    | PutApiScenariosByIdResponse400
    | PutApiScenariosByIdResponse401
    | PutApiScenariosByIdResponse404
    | PutApiScenariosByIdResponse422
    | PutApiScenariosByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiScenariosByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiScenariosByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiScenariosByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PutApiScenariosByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PutApiScenariosByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiScenariosByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiScenariosByIdResponse200
    | PutApiScenariosByIdResponse400
    | PutApiScenariosByIdResponse401
    | PutApiScenariosByIdResponse404
    | PutApiScenariosByIdResponse422
    | PutApiScenariosByIdResponse500
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
    body: PutApiScenariosByIdBody | Unset = UNSET,
) -> Response[
    PutApiScenariosByIdResponse200
    | PutApiScenariosByIdResponse400
    | PutApiScenariosByIdResponse401
    | PutApiScenariosByIdResponse404
    | PutApiScenariosByIdResponse422
    | PutApiScenariosByIdResponse500
]:
    """Update an existing scenario

    Args:
        id (str):
        body (PutApiScenariosByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiScenariosByIdResponse200 | PutApiScenariosByIdResponse400 | PutApiScenariosByIdResponse401 | PutApiScenariosByIdResponse404 | PutApiScenariosByIdResponse422 | PutApiScenariosByIdResponse500]
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
    body: PutApiScenariosByIdBody | Unset = UNSET,
) -> (
    PutApiScenariosByIdResponse200
    | PutApiScenariosByIdResponse400
    | PutApiScenariosByIdResponse401
    | PutApiScenariosByIdResponse404
    | PutApiScenariosByIdResponse422
    | PutApiScenariosByIdResponse500
    | None
):
    """Update an existing scenario

    Args:
        id (str):
        body (PutApiScenariosByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiScenariosByIdResponse200 | PutApiScenariosByIdResponse400 | PutApiScenariosByIdResponse401 | PutApiScenariosByIdResponse404 | PutApiScenariosByIdResponse422 | PutApiScenariosByIdResponse500
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
    body: PutApiScenariosByIdBody | Unset = UNSET,
) -> Response[
    PutApiScenariosByIdResponse200
    | PutApiScenariosByIdResponse400
    | PutApiScenariosByIdResponse401
    | PutApiScenariosByIdResponse404
    | PutApiScenariosByIdResponse422
    | PutApiScenariosByIdResponse500
]:
    """Update an existing scenario

    Args:
        id (str):
        body (PutApiScenariosByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiScenariosByIdResponse200 | PutApiScenariosByIdResponse400 | PutApiScenariosByIdResponse401 | PutApiScenariosByIdResponse404 | PutApiScenariosByIdResponse422 | PutApiScenariosByIdResponse500]
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
    body: PutApiScenariosByIdBody | Unset = UNSET,
) -> (
    PutApiScenariosByIdResponse200
    | PutApiScenariosByIdResponse400
    | PutApiScenariosByIdResponse401
    | PutApiScenariosByIdResponse404
    | PutApiScenariosByIdResponse422
    | PutApiScenariosByIdResponse500
    | None
):
    """Update an existing scenario

    Args:
        id (str):
        body (PutApiScenariosByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiScenariosByIdResponse200 | PutApiScenariosByIdResponse400 | PutApiScenariosByIdResponse401 | PutApiScenariosByIdResponse404 | PutApiScenariosByIdResponse422 | PutApiScenariosByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
