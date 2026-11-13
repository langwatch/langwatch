import datetime
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_registry_agents_response_200 import GetApiGovernanceRegistryAgentsResponse200
from ...models.get_api_governance_registry_agents_response_400 import GetApiGovernanceRegistryAgentsResponse400
from ...models.get_api_governance_registry_agents_response_401 import GetApiGovernanceRegistryAgentsResponse401
from ...models.get_api_governance_registry_agents_response_422 import GetApiGovernanceRegistryAgentsResponse422
from ...models.get_api_governance_registry_agents_response_500 import GetApiGovernanceRegistryAgentsResponse500
from ...models.get_api_governance_registry_agents_status import GetApiGovernanceRegistryAgentsStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    updated_since: datetime.datetime | Unset = UNSET,
    status: GetApiGovernanceRegistryAgentsStatus | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    json_updated_since: str | Unset = UNSET
    if not isinstance(updated_since, Unset):
        json_updated_since = updated_since.isoformat()
    params["updated_since"] = json_updated_since

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/registry/agents",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceRegistryAgentsResponse200
    | GetApiGovernanceRegistryAgentsResponse400
    | GetApiGovernanceRegistryAgentsResponse401
    | GetApiGovernanceRegistryAgentsResponse422
    | GetApiGovernanceRegistryAgentsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceRegistryAgentsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceRegistryAgentsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceRegistryAgentsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiGovernanceRegistryAgentsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceRegistryAgentsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceRegistryAgentsResponse200
    | GetApiGovernanceRegistryAgentsResponse400
    | GetApiGovernanceRegistryAgentsResponse401
    | GetApiGovernanceRegistryAgentsResponse422
    | GetApiGovernanceRegistryAgentsResponse500
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
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    updated_since: datetime.datetime | Unset = UNSET,
    status: GetApiGovernanceRegistryAgentsStatus | Unset = UNSET,
) -> Response[
    GetApiGovernanceRegistryAgentsResponse200
    | GetApiGovernanceRegistryAgentsResponse400
    | GetApiGovernanceRegistryAgentsResponse401
    | GetApiGovernanceRegistryAgentsResponse422
    | GetApiGovernanceRegistryAgentsResponse500
]:
    """List the organisation's agent registry

     Every agent LangWatch sees for the organisation: agents defined in its projects, agents a governance
    source listed (Databricks Genie, Copilot Studio) and agents its traces name in `gen_ai.agent.name`.
    Ordered by last change, oldest first; pass `next_cursor` back as `cursor`. `updated_since` returns
    only entries changed at or after that instant.

    Args:
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        updated_since (datetime.datetime | Unset):
        status (GetApiGovernanceRegistryAgentsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryAgentsResponse200 | GetApiGovernanceRegistryAgentsResponse400 | GetApiGovernanceRegistryAgentsResponse401 | GetApiGovernanceRegistryAgentsResponse422 | GetApiGovernanceRegistryAgentsResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        updated_since=updated_since,
        status=status,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    updated_since: datetime.datetime | Unset = UNSET,
    status: GetApiGovernanceRegistryAgentsStatus | Unset = UNSET,
) -> (
    GetApiGovernanceRegistryAgentsResponse200
    | GetApiGovernanceRegistryAgentsResponse400
    | GetApiGovernanceRegistryAgentsResponse401
    | GetApiGovernanceRegistryAgentsResponse422
    | GetApiGovernanceRegistryAgentsResponse500
    | None
):
    """List the organisation's agent registry

     Every agent LangWatch sees for the organisation: agents defined in its projects, agents a governance
    source listed (Databricks Genie, Copilot Studio) and agents its traces name in `gen_ai.agent.name`.
    Ordered by last change, oldest first; pass `next_cursor` back as `cursor`. `updated_since` returns
    only entries changed at or after that instant.

    Args:
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        updated_since (datetime.datetime | Unset):
        status (GetApiGovernanceRegistryAgentsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryAgentsResponse200 | GetApiGovernanceRegistryAgentsResponse400 | GetApiGovernanceRegistryAgentsResponse401 | GetApiGovernanceRegistryAgentsResponse422 | GetApiGovernanceRegistryAgentsResponse500
    """

    return sync_detailed(
        client=client,
        limit=limit,
        cursor=cursor,
        updated_since=updated_since,
        status=status,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    updated_since: datetime.datetime | Unset = UNSET,
    status: GetApiGovernanceRegistryAgentsStatus | Unset = UNSET,
) -> Response[
    GetApiGovernanceRegistryAgentsResponse200
    | GetApiGovernanceRegistryAgentsResponse400
    | GetApiGovernanceRegistryAgentsResponse401
    | GetApiGovernanceRegistryAgentsResponse422
    | GetApiGovernanceRegistryAgentsResponse500
]:
    """List the organisation's agent registry

     Every agent LangWatch sees for the organisation: agents defined in its projects, agents a governance
    source listed (Databricks Genie, Copilot Studio) and agents its traces name in `gen_ai.agent.name`.
    Ordered by last change, oldest first; pass `next_cursor` back as `cursor`. `updated_since` returns
    only entries changed at or after that instant.

    Args:
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        updated_since (datetime.datetime | Unset):
        status (GetApiGovernanceRegistryAgentsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryAgentsResponse200 | GetApiGovernanceRegistryAgentsResponse400 | GetApiGovernanceRegistryAgentsResponse401 | GetApiGovernanceRegistryAgentsResponse422 | GetApiGovernanceRegistryAgentsResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        updated_since=updated_since,
        status=status,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    updated_since: datetime.datetime | Unset = UNSET,
    status: GetApiGovernanceRegistryAgentsStatus | Unset = UNSET,
) -> (
    GetApiGovernanceRegistryAgentsResponse200
    | GetApiGovernanceRegistryAgentsResponse400
    | GetApiGovernanceRegistryAgentsResponse401
    | GetApiGovernanceRegistryAgentsResponse422
    | GetApiGovernanceRegistryAgentsResponse500
    | None
):
    """List the organisation's agent registry

     Every agent LangWatch sees for the organisation: agents defined in its projects, agents a governance
    source listed (Databricks Genie, Copilot Studio) and agents its traces name in `gen_ai.agent.name`.
    Ordered by last change, oldest first; pass `next_cursor` back as `cursor`. `updated_since` returns
    only entries changed at or after that instant.

    Args:
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        updated_since (datetime.datetime | Unset):
        status (GetApiGovernanceRegistryAgentsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryAgentsResponse200 | GetApiGovernanceRegistryAgentsResponse400 | GetApiGovernanceRegistryAgentsResponse401 | GetApiGovernanceRegistryAgentsResponse422 | GetApiGovernanceRegistryAgentsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            cursor=cursor,
            updated_since=updated_since,
            status=status,
        )
    ).parsed
