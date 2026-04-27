from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_simulation_runs_by_scenario_run_id_response_200 import (
    GetApiSimulationRunsByScenarioRunIdResponse200,
)
from ...models.get_api_simulation_runs_by_scenario_run_id_response_400 import (
    GetApiSimulationRunsByScenarioRunIdResponse400,
)
from ...models.get_api_simulation_runs_by_scenario_run_id_response_401 import (
    GetApiSimulationRunsByScenarioRunIdResponse401,
)
from ...models.get_api_simulation_runs_by_scenario_run_id_response_404 import (
    GetApiSimulationRunsByScenarioRunIdResponse404,
)
from ...models.get_api_simulation_runs_by_scenario_run_id_response_422 import (
    GetApiSimulationRunsByScenarioRunIdResponse422,
)
from ...models.get_api_simulation_runs_by_scenario_run_id_response_500 import (
    GetApiSimulationRunsByScenarioRunIdResponse500,
)
from ...types import Response


def _get_kwargs(
    scenario_run_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/simulation-runs/{scenario_run_id}".format(
            scenario_run_id=quote(str(scenario_run_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSimulationRunsByScenarioRunIdResponse200
    | GetApiSimulationRunsByScenarioRunIdResponse400
    | GetApiSimulationRunsByScenarioRunIdResponse401
    | GetApiSimulationRunsByScenarioRunIdResponse404
    | GetApiSimulationRunsByScenarioRunIdResponse422
    | GetApiSimulationRunsByScenarioRunIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiSimulationRunsByScenarioRunIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSimulationRunsByScenarioRunIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSimulationRunsByScenarioRunIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiSimulationRunsByScenarioRunIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiSimulationRunsByScenarioRunIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSimulationRunsByScenarioRunIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSimulationRunsByScenarioRunIdResponse200
    | GetApiSimulationRunsByScenarioRunIdResponse400
    | GetApiSimulationRunsByScenarioRunIdResponse401
    | GetApiSimulationRunsByScenarioRunIdResponse404
    | GetApiSimulationRunsByScenarioRunIdResponse422
    | GetApiSimulationRunsByScenarioRunIdResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiSimulationRunsByScenarioRunIdResponse200
    | GetApiSimulationRunsByScenarioRunIdResponse400
    | GetApiSimulationRunsByScenarioRunIdResponse401
    | GetApiSimulationRunsByScenarioRunIdResponse404
    | GetApiSimulationRunsByScenarioRunIdResponse422
    | GetApiSimulationRunsByScenarioRunIdResponse500
]:
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse400 | GetApiSimulationRunsByScenarioRunIdResponse401 | GetApiSimulationRunsByScenarioRunIdResponse404 | GetApiSimulationRunsByScenarioRunIdResponse422 | GetApiSimulationRunsByScenarioRunIdResponse500]
    """

    kwargs = _get_kwargs(
        scenario_run_id=scenario_run_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiSimulationRunsByScenarioRunIdResponse200
    | GetApiSimulationRunsByScenarioRunIdResponse400
    | GetApiSimulationRunsByScenarioRunIdResponse401
    | GetApiSimulationRunsByScenarioRunIdResponse404
    | GetApiSimulationRunsByScenarioRunIdResponse422
    | GetApiSimulationRunsByScenarioRunIdResponse500
    | None
):
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse400 | GetApiSimulationRunsByScenarioRunIdResponse401 | GetApiSimulationRunsByScenarioRunIdResponse404 | GetApiSimulationRunsByScenarioRunIdResponse422 | GetApiSimulationRunsByScenarioRunIdResponse500
    """

    return sync_detailed(
        scenario_run_id=scenario_run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiSimulationRunsByScenarioRunIdResponse200
    | GetApiSimulationRunsByScenarioRunIdResponse400
    | GetApiSimulationRunsByScenarioRunIdResponse401
    | GetApiSimulationRunsByScenarioRunIdResponse404
    | GetApiSimulationRunsByScenarioRunIdResponse422
    | GetApiSimulationRunsByScenarioRunIdResponse500
]:
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse400 | GetApiSimulationRunsByScenarioRunIdResponse401 | GetApiSimulationRunsByScenarioRunIdResponse404 | GetApiSimulationRunsByScenarioRunIdResponse422 | GetApiSimulationRunsByScenarioRunIdResponse500]
    """

    kwargs = _get_kwargs(
        scenario_run_id=scenario_run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiSimulationRunsByScenarioRunIdResponse200
    | GetApiSimulationRunsByScenarioRunIdResponse400
    | GetApiSimulationRunsByScenarioRunIdResponse401
    | GetApiSimulationRunsByScenarioRunIdResponse404
    | GetApiSimulationRunsByScenarioRunIdResponse422
    | GetApiSimulationRunsByScenarioRunIdResponse500
    | None
):
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse400 | GetApiSimulationRunsByScenarioRunIdResponse401 | GetApiSimulationRunsByScenarioRunIdResponse404 | GetApiSimulationRunsByScenarioRunIdResponse422 | GetApiSimulationRunsByScenarioRunIdResponse500
    """

    return (
        await asyncio_detailed(
            scenario_run_id=scenario_run_id,
            client=client,
        )
    ).parsed
