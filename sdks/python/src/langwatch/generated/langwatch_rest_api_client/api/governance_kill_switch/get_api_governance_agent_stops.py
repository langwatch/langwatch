from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_agent_stops_response_200 import GetApiGovernanceAgentStopsResponse200
from ...models.get_api_governance_agent_stops_response_400 import GetApiGovernanceAgentStopsResponse400
from ...models.get_api_governance_agent_stops_response_401 import GetApiGovernanceAgentStopsResponse401
from ...models.get_api_governance_agent_stops_response_403 import GetApiGovernanceAgentStopsResponse403
from ...models.get_api_governance_agent_stops_response_422 import GetApiGovernanceAgentStopsResponse422
from ...models.get_api_governance_agent_stops_response_500 import GetApiGovernanceAgentStopsResponse500
from ...models.get_api_governance_agent_stops_status import GetApiGovernanceAgentStopsStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    status: GetApiGovernanceAgentStopsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/agent-stops",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceAgentStopsResponse200
    | GetApiGovernanceAgentStopsResponse400
    | GetApiGovernanceAgentStopsResponse401
    | GetApiGovernanceAgentStopsResponse403
    | GetApiGovernanceAgentStopsResponse422
    | GetApiGovernanceAgentStopsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceAgentStopsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceAgentStopsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceAgentStopsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceAgentStopsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = GetApiGovernanceAgentStopsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceAgentStopsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceAgentStopsResponse200
    | GetApiGovernanceAgentStopsResponse400
    | GetApiGovernanceAgentStopsResponse401
    | GetApiGovernanceAgentStopsResponse403
    | GetApiGovernanceAgentStopsResponse422
    | GetApiGovernanceAgentStopsResponse500
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
    *,
    client: AuthenticatedClient,
    status: GetApiGovernanceAgentStopsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceAgentStopsResponse200
    | GetApiGovernanceAgentStopsResponse400
    | GetApiGovernanceAgentStopsResponse401
    | GetApiGovernanceAgentStopsResponse403
    | GetApiGovernanceAgentStopsResponse422
    | GetApiGovernanceAgentStopsResponse500
]:
    """List the organisation's agent stops

     The organisation's stops, latest request first, `limit` at a time (default 50, at most 200). Pass
    `next_cursor` back as `cursor` for the next page; it is null on the last page.
    `status=pending_approval` lists the stops waiting for a decision.

    Args:
        status (GetApiGovernanceAgentStopsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceAgentStopsResponse200 | GetApiGovernanceAgentStopsResponse400 | GetApiGovernanceAgentStopsResponse401 | GetApiGovernanceAgentStopsResponse403 | GetApiGovernanceAgentStopsResponse422 | GetApiGovernanceAgentStopsResponse500]
    """

    kwargs = _get_kwargs(
        status=status,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    status: GetApiGovernanceAgentStopsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceAgentStopsResponse200
    | GetApiGovernanceAgentStopsResponse400
    | GetApiGovernanceAgentStopsResponse401
    | GetApiGovernanceAgentStopsResponse403
    | GetApiGovernanceAgentStopsResponse422
    | GetApiGovernanceAgentStopsResponse500
    | None
):
    """List the organisation's agent stops

     The organisation's stops, latest request first, `limit` at a time (default 50, at most 200). Pass
    `next_cursor` back as `cursor` for the next page; it is null on the last page.
    `status=pending_approval` lists the stops waiting for a decision.

    Args:
        status (GetApiGovernanceAgentStopsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceAgentStopsResponse200 | GetApiGovernanceAgentStopsResponse400 | GetApiGovernanceAgentStopsResponse401 | GetApiGovernanceAgentStopsResponse403 | GetApiGovernanceAgentStopsResponse422 | GetApiGovernanceAgentStopsResponse500
    """

    return sync_detailed(
        client=client,
        status=status,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    status: GetApiGovernanceAgentStopsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceAgentStopsResponse200
    | GetApiGovernanceAgentStopsResponse400
    | GetApiGovernanceAgentStopsResponse401
    | GetApiGovernanceAgentStopsResponse403
    | GetApiGovernanceAgentStopsResponse422
    | GetApiGovernanceAgentStopsResponse500
]:
    """List the organisation's agent stops

     The organisation's stops, latest request first, `limit` at a time (default 50, at most 200). Pass
    `next_cursor` back as `cursor` for the next page; it is null on the last page.
    `status=pending_approval` lists the stops waiting for a decision.

    Args:
        status (GetApiGovernanceAgentStopsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceAgentStopsResponse200 | GetApiGovernanceAgentStopsResponse400 | GetApiGovernanceAgentStopsResponse401 | GetApiGovernanceAgentStopsResponse403 | GetApiGovernanceAgentStopsResponse422 | GetApiGovernanceAgentStopsResponse500]
    """

    kwargs = _get_kwargs(
        status=status,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    status: GetApiGovernanceAgentStopsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceAgentStopsResponse200
    | GetApiGovernanceAgentStopsResponse400
    | GetApiGovernanceAgentStopsResponse401
    | GetApiGovernanceAgentStopsResponse403
    | GetApiGovernanceAgentStopsResponse422
    | GetApiGovernanceAgentStopsResponse500
    | None
):
    """List the organisation's agent stops

     The organisation's stops, latest request first, `limit` at a time (default 50, at most 200). Pass
    `next_cursor` back as `cursor` for the next page; it is null on the last page.
    `status=pending_approval` lists the stops waiting for a decision.

    Args:
        status (GetApiGovernanceAgentStopsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceAgentStopsResponse200 | GetApiGovernanceAgentStopsResponse400 | GetApiGovernanceAgentStopsResponse401 | GetApiGovernanceAgentStopsResponse403 | GetApiGovernanceAgentStopsResponse422 | GetApiGovernanceAgentStopsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            status=status,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
