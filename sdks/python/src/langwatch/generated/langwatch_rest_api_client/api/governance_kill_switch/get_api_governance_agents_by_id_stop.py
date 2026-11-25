from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_agents_by_id_stop_response_200 import GetApiGovernanceAgentsByIdStopResponse200
from ...models.get_api_governance_agents_by_id_stop_response_400 import GetApiGovernanceAgentsByIdStopResponse400
from ...models.get_api_governance_agents_by_id_stop_response_401 import GetApiGovernanceAgentsByIdStopResponse401
from ...models.get_api_governance_agents_by_id_stop_response_403 import GetApiGovernanceAgentsByIdStopResponse403
from ...models.get_api_governance_agents_by_id_stop_response_404 import GetApiGovernanceAgentsByIdStopResponse404
from ...models.get_api_governance_agents_by_id_stop_response_422 import GetApiGovernanceAgentsByIdStopResponse422
from ...models.get_api_governance_agents_by_id_stop_response_500 import GetApiGovernanceAgentsByIdStopResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    agent_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/agents/{agent_id}/stop".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceAgentsByIdStopResponse200
    | GetApiGovernanceAgentsByIdStopResponse400
    | GetApiGovernanceAgentsByIdStopResponse401
    | GetApiGovernanceAgentsByIdStopResponse403
    | GetApiGovernanceAgentsByIdStopResponse404
    | GetApiGovernanceAgentsByIdStopResponse422
    | GetApiGovernanceAgentsByIdStopResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceAgentsByIdStopResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceAgentsByIdStopResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceAgentsByIdStopResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceAgentsByIdStopResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiGovernanceAgentsByIdStopResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiGovernanceAgentsByIdStopResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceAgentsByIdStopResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceAgentsByIdStopResponse200
    | GetApiGovernanceAgentsByIdStopResponse400
    | GetApiGovernanceAgentsByIdStopResponse401
    | GetApiGovernanceAgentsByIdStopResponse403
    | GetApiGovernanceAgentsByIdStopResponse404
    | GetApiGovernanceAgentsByIdStopResponse422
    | GetApiGovernanceAgentsByIdStopResponse500
]:
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
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceAgentsByIdStopResponse200
    | GetApiGovernanceAgentsByIdStopResponse400
    | GetApiGovernanceAgentsByIdStopResponse401
    | GetApiGovernanceAgentsByIdStopResponse403
    | GetApiGovernanceAgentsByIdStopResponse404
    | GetApiGovernanceAgentsByIdStopResponse422
    | GetApiGovernanceAgentsByIdStopResponse500
]:
    """Get an agent's latest stop

     The agent's latest stop with its status and every target's outcome (`pending`, `applied`, `failed`,
    `reverted`, `revert_failed`) and error code. An agent that was never stopped is a 404
    `agent_stop_not_found`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceAgentsByIdStopResponse200 | GetApiGovernanceAgentsByIdStopResponse400 | GetApiGovernanceAgentsByIdStopResponse401 | GetApiGovernanceAgentsByIdStopResponse403 | GetApiGovernanceAgentsByIdStopResponse404 | GetApiGovernanceAgentsByIdStopResponse422 | GetApiGovernanceAgentsByIdStopResponse500]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceAgentsByIdStopResponse200
    | GetApiGovernanceAgentsByIdStopResponse400
    | GetApiGovernanceAgentsByIdStopResponse401
    | GetApiGovernanceAgentsByIdStopResponse403
    | GetApiGovernanceAgentsByIdStopResponse404
    | GetApiGovernanceAgentsByIdStopResponse422
    | GetApiGovernanceAgentsByIdStopResponse500
    | None
):
    """Get an agent's latest stop

     The agent's latest stop with its status and every target's outcome (`pending`, `applied`, `failed`,
    `reverted`, `revert_failed`) and error code. An agent that was never stopped is a 404
    `agent_stop_not_found`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceAgentsByIdStopResponse200 | GetApiGovernanceAgentsByIdStopResponse400 | GetApiGovernanceAgentsByIdStopResponse401 | GetApiGovernanceAgentsByIdStopResponse403 | GetApiGovernanceAgentsByIdStopResponse404 | GetApiGovernanceAgentsByIdStopResponse422 | GetApiGovernanceAgentsByIdStopResponse500
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceAgentsByIdStopResponse200
    | GetApiGovernanceAgentsByIdStopResponse400
    | GetApiGovernanceAgentsByIdStopResponse401
    | GetApiGovernanceAgentsByIdStopResponse403
    | GetApiGovernanceAgentsByIdStopResponse404
    | GetApiGovernanceAgentsByIdStopResponse422
    | GetApiGovernanceAgentsByIdStopResponse500
]:
    """Get an agent's latest stop

     The agent's latest stop with its status and every target's outcome (`pending`, `applied`, `failed`,
    `reverted`, `revert_failed`) and error code. An agent that was never stopped is a 404
    `agent_stop_not_found`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceAgentsByIdStopResponse200 | GetApiGovernanceAgentsByIdStopResponse400 | GetApiGovernanceAgentsByIdStopResponse401 | GetApiGovernanceAgentsByIdStopResponse403 | GetApiGovernanceAgentsByIdStopResponse404 | GetApiGovernanceAgentsByIdStopResponse422 | GetApiGovernanceAgentsByIdStopResponse500]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceAgentsByIdStopResponse200
    | GetApiGovernanceAgentsByIdStopResponse400
    | GetApiGovernanceAgentsByIdStopResponse401
    | GetApiGovernanceAgentsByIdStopResponse403
    | GetApiGovernanceAgentsByIdStopResponse404
    | GetApiGovernanceAgentsByIdStopResponse422
    | GetApiGovernanceAgentsByIdStopResponse500
    | None
):
    """Get an agent's latest stop

     The agent's latest stop with its status and every target's outcome (`pending`, `applied`, `failed`,
    `reverted`, `revert_failed`) and error code. An agent that was never stopped is a 404
    `agent_stop_not_found`.

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceAgentsByIdStopResponse200 | GetApiGovernanceAgentsByIdStopResponse400 | GetApiGovernanceAgentsByIdStopResponse401 | GetApiGovernanceAgentsByIdStopResponse403 | GetApiGovernanceAgentsByIdStopResponse404 | GetApiGovernanceAgentsByIdStopResponse422 | GetApiGovernanceAgentsByIdStopResponse500
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
        )
    ).parsed
