from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_simulation_runs_response_200 import GetApiSimulationRunsResponse200
from ...models.get_api_simulation_runs_response_400 import GetApiSimulationRunsResponse400
from ...models.get_api_simulation_runs_response_401 import GetApiSimulationRunsResponse401
from ...models.get_api_simulation_runs_response_422 import GetApiSimulationRunsResponse422
from ...models.get_api_simulation_runs_response_500 import GetApiSimulationRunsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    scenario_set_id: str | Unset = UNSET,
    batch_run_id: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["scenarioSetId"] = scenario_set_id

    params["batchRunId"] = batch_run_id

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/simulation-runs",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSimulationRunsResponse200
    | GetApiSimulationRunsResponse400
    | GetApiSimulationRunsResponse401
    | GetApiSimulationRunsResponse422
    | GetApiSimulationRunsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiSimulationRunsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSimulationRunsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSimulationRunsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiSimulationRunsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSimulationRunsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSimulationRunsResponse200
    | GetApiSimulationRunsResponse400
    | GetApiSimulationRunsResponse401
    | GetApiSimulationRunsResponse422
    | GetApiSimulationRunsResponse500
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
    scenario_set_id: str | Unset = UNSET,
    batch_run_id: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiSimulationRunsResponse200
    | GetApiSimulationRunsResponse400
    | GetApiSimulationRunsResponse401
    | GetApiSimulationRunsResponse422
    | GetApiSimulationRunsResponse500
]:
    """List simulation runs, optionally filtered by scenarioSetId or batchRunId

    Args:
        scenario_set_id (str | Unset):
        batch_run_id (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsResponse200 | GetApiSimulationRunsResponse400 | GetApiSimulationRunsResponse401 | GetApiSimulationRunsResponse422 | GetApiSimulationRunsResponse500]
    """

    kwargs = _get_kwargs(
        scenario_set_id=scenario_set_id,
        batch_run_id=batch_run_id,
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
    scenario_set_id: str | Unset = UNSET,
    batch_run_id: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> (
    GetApiSimulationRunsResponse200
    | GetApiSimulationRunsResponse400
    | GetApiSimulationRunsResponse401
    | GetApiSimulationRunsResponse422
    | GetApiSimulationRunsResponse500
    | None
):
    """List simulation runs, optionally filtered by scenarioSetId or batchRunId

    Args:
        scenario_set_id (str | Unset):
        batch_run_id (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsResponse200 | GetApiSimulationRunsResponse400 | GetApiSimulationRunsResponse401 | GetApiSimulationRunsResponse422 | GetApiSimulationRunsResponse500
    """

    return sync_detailed(
        client=client,
        scenario_set_id=scenario_set_id,
        batch_run_id=batch_run_id,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    scenario_set_id: str | Unset = UNSET,
    batch_run_id: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiSimulationRunsResponse200
    | GetApiSimulationRunsResponse400
    | GetApiSimulationRunsResponse401
    | GetApiSimulationRunsResponse422
    | GetApiSimulationRunsResponse500
]:
    """List simulation runs, optionally filtered by scenarioSetId or batchRunId

    Args:
        scenario_set_id (str | Unset):
        batch_run_id (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsResponse200 | GetApiSimulationRunsResponse400 | GetApiSimulationRunsResponse401 | GetApiSimulationRunsResponse422 | GetApiSimulationRunsResponse500]
    """

    kwargs = _get_kwargs(
        scenario_set_id=scenario_set_id,
        batch_run_id=batch_run_id,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    scenario_set_id: str | Unset = UNSET,
    batch_run_id: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> (
    GetApiSimulationRunsResponse200
    | GetApiSimulationRunsResponse400
    | GetApiSimulationRunsResponse401
    | GetApiSimulationRunsResponse422
    | GetApiSimulationRunsResponse500
    | None
):
    """List simulation runs, optionally filtered by scenarioSetId or batchRunId

    Args:
        scenario_set_id (str | Unset):
        batch_run_id (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsResponse200 | GetApiSimulationRunsResponse400 | GetApiSimulationRunsResponse401 | GetApiSimulationRunsResponse422 | GetApiSimulationRunsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            scenario_set_id=scenario_set_id,
            batch_run_id=batch_run_id,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
