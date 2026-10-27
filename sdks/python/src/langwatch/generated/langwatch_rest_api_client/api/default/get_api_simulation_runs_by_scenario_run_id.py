from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_simulation_runs_by_scenario_run_id_response_200 import (
    GetApiSimulationRunsByScenarioRunIdResponse200,
)
from ...models.get_api_simulation_runs_by_scenario_run_id_response_404 import (
    GetApiSimulationRunsByScenarioRunIdResponse404,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    scenario_run_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/simulation-runs/{scenario_run_id}".format(
            scenario_run_id=quote(str(scenario_run_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404 | None:
    if response.status_code == 200:
        response_200 = GetApiSimulationRunsByScenarioRunIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetApiSimulationRunsByScenarioRunIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404]:
    # LangWatch override: use safe_http_status to tolerate non-IANA status codes
    # (Cloudflare 520-527, AWS WAF 561, etc). Upstream still crashes here.
    # Tracked upstream: https://github.com/openapi-generators/openapi-python-client/pull/1407
    return Response(
        status_code=safe_http_status(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404]:
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404]
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
    client: AuthenticatedClient,
) -> GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404 | None:
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404
    """

    return sync_detailed(
        scenario_run_id=scenario_run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404]:
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404]
    """

    kwargs = _get_kwargs(
        scenario_run_id=scenario_run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    scenario_run_id: str,
    *,
    client: AuthenticatedClient,
) -> GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404 | None:
    """Get a single simulation run by its ID

    Args:
        scenario_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsByScenarioRunIdResponse200 | GetApiSimulationRunsByScenarioRunIdResponse404
    """

    return (
        await asyncio_detailed(
            scenario_run_id=scenario_run_id,
            client=client,
        )
    ).parsed
