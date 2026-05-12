from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_simulation_runs_batches_list_response_200 import GetApiSimulationRunsBatchesListResponse200
from ...models.get_api_simulation_runs_batches_list_response_400 import GetApiSimulationRunsBatchesListResponse400
from ...models.get_api_simulation_runs_batches_list_response_401 import GetApiSimulationRunsBatchesListResponse401
from ...models.get_api_simulation_runs_batches_list_response_422 import GetApiSimulationRunsBatchesListResponse422
from ...models.get_api_simulation_runs_batches_list_response_500 import GetApiSimulationRunsBatchesListResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    scenario_set_id: str,
    limit: int | Unset = 10,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["scenarioSetId"] = scenario_set_id

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/simulation-runs/batches/list",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSimulationRunsBatchesListResponse200
    | GetApiSimulationRunsBatchesListResponse400
    | GetApiSimulationRunsBatchesListResponse401
    | GetApiSimulationRunsBatchesListResponse422
    | GetApiSimulationRunsBatchesListResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiSimulationRunsBatchesListResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSimulationRunsBatchesListResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSimulationRunsBatchesListResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiSimulationRunsBatchesListResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSimulationRunsBatchesListResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSimulationRunsBatchesListResponse200
    | GetApiSimulationRunsBatchesListResponse400
    | GetApiSimulationRunsBatchesListResponse401
    | GetApiSimulationRunsBatchesListResponse422
    | GetApiSimulationRunsBatchesListResponse500
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
    scenario_set_id: str,
    limit: int | Unset = 10,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiSimulationRunsBatchesListResponse200
    | GetApiSimulationRunsBatchesListResponse400
    | GetApiSimulationRunsBatchesListResponse401
    | GetApiSimulationRunsBatchesListResponse422
    | GetApiSimulationRunsBatchesListResponse500
]:
    """List batch summaries for a scenario set (pass/fail counts per batch)

    Args:
        scenario_set_id (str):
        limit (int | Unset):  Default: 10.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsBatchesListResponse200 | GetApiSimulationRunsBatchesListResponse400 | GetApiSimulationRunsBatchesListResponse401 | GetApiSimulationRunsBatchesListResponse422 | GetApiSimulationRunsBatchesListResponse500]
    """

    kwargs = _get_kwargs(
        scenario_set_id=scenario_set_id,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    scenario_set_id: str,
    limit: int | Unset = 10,
    cursor: str | Unset = UNSET,
) -> (
    GetApiSimulationRunsBatchesListResponse200
    | GetApiSimulationRunsBatchesListResponse400
    | GetApiSimulationRunsBatchesListResponse401
    | GetApiSimulationRunsBatchesListResponse422
    | GetApiSimulationRunsBatchesListResponse500
    | None
):
    """List batch summaries for a scenario set (pass/fail counts per batch)

    Args:
        scenario_set_id (str):
        limit (int | Unset):  Default: 10.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsBatchesListResponse200 | GetApiSimulationRunsBatchesListResponse400 | GetApiSimulationRunsBatchesListResponse401 | GetApiSimulationRunsBatchesListResponse422 | GetApiSimulationRunsBatchesListResponse500
    """

    return sync_detailed(
        client=client,
        scenario_set_id=scenario_set_id,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    scenario_set_id: str,
    limit: int | Unset = 10,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiSimulationRunsBatchesListResponse200
    | GetApiSimulationRunsBatchesListResponse400
    | GetApiSimulationRunsBatchesListResponse401
    | GetApiSimulationRunsBatchesListResponse422
    | GetApiSimulationRunsBatchesListResponse500
]:
    """List batch summaries for a scenario set (pass/fail counts per batch)

    Args:
        scenario_set_id (str):
        limit (int | Unset):  Default: 10.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsBatchesListResponse200 | GetApiSimulationRunsBatchesListResponse400 | GetApiSimulationRunsBatchesListResponse401 | GetApiSimulationRunsBatchesListResponse422 | GetApiSimulationRunsBatchesListResponse500]
    """

    kwargs = _get_kwargs(
        scenario_set_id=scenario_set_id,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    scenario_set_id: str,
    limit: int | Unset = 10,
    cursor: str | Unset = UNSET,
) -> (
    GetApiSimulationRunsBatchesListResponse200
    | GetApiSimulationRunsBatchesListResponse400
    | GetApiSimulationRunsBatchesListResponse401
    | GetApiSimulationRunsBatchesListResponse422
    | GetApiSimulationRunsBatchesListResponse500
    | None
):
    """List batch summaries for a scenario set (pass/fail counts per batch)

    Args:
        scenario_set_id (str):
        limit (int | Unset):  Default: 10.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsBatchesListResponse200 | GetApiSimulationRunsBatchesListResponse400 | GetApiSimulationRunsBatchesListResponse401 | GetApiSimulationRunsBatchesListResponse422 | GetApiSimulationRunsBatchesListResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            scenario_set_id=scenario_set_id,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
