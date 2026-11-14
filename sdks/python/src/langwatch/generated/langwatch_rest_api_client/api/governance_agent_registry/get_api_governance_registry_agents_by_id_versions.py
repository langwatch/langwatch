from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_registry_agents_by_id_versions_response_200 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200,
)
from ...models.get_api_governance_registry_agents_by_id_versions_response_400 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse400,
)
from ...models.get_api_governance_registry_agents_by_id_versions_response_401 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse401,
)
from ...models.get_api_governance_registry_agents_by_id_versions_response_403 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse403,
)
from ...models.get_api_governance_registry_agents_by_id_versions_response_404 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse404,
)
from ...models.get_api_governance_registry_agents_by_id_versions_response_422 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse422,
)
from ...models.get_api_governance_registry_agents_by_id_versions_response_500 import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    agent_id: str,
    *,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/registry/agents/{agent_id}/versions".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse400
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse401
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse403
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse404
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse422
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceRegistryAgentsByIdVersionsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceRegistryAgentsByIdVersionsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceRegistryAgentsByIdVersionsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceRegistryAgentsByIdVersionsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiGovernanceRegistryAgentsByIdVersionsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiGovernanceRegistryAgentsByIdVersionsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceRegistryAgentsByIdVersionsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse400
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse401
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse403
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse404
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse422
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
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
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse400
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse401
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse403
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse404
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse422
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
]:
    """List one registry agent's versions

     The change events recorded for the agent, oldest first, one page at a time. Each carries
    `from_version`, `to_version` and the entry as it stood at `to_version`. Pass `next_cursor` back as
    `cursor` for the next page; it is null on the last page.

    Args:
        agent_id (str):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryAgentsByIdVersionsResponse200 | GetApiGovernanceRegistryAgentsByIdVersionsResponse400 | GetApiGovernanceRegistryAgentsByIdVersionsResponse401 | GetApiGovernanceRegistryAgentsByIdVersionsResponse403 | GetApiGovernanceRegistryAgentsByIdVersionsResponse404 | GetApiGovernanceRegistryAgentsByIdVersionsResponse422 | GetApiGovernanceRegistryAgentsByIdVersionsResponse500]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse400
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse401
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse403
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse404
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse422
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
    | None
):
    """List one registry agent's versions

     The change events recorded for the agent, oldest first, one page at a time. Each carries
    `from_version`, `to_version` and the entry as it stood at `to_version`. Pass `next_cursor` back as
    `cursor` for the next page; it is null on the last page.

    Args:
        agent_id (str):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200 | GetApiGovernanceRegistryAgentsByIdVersionsResponse400 | GetApiGovernanceRegistryAgentsByIdVersionsResponse401 | GetApiGovernanceRegistryAgentsByIdVersionsResponse403 | GetApiGovernanceRegistryAgentsByIdVersionsResponse404 | GetApiGovernanceRegistryAgentsByIdVersionsResponse422 | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse400
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse401
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse403
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse404
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse422
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
]:
    """List one registry agent's versions

     The change events recorded for the agent, oldest first, one page at a time. Each carries
    `from_version`, `to_version` and the entry as it stood at `to_version`. Pass `next_cursor` back as
    `cursor` for the next page; it is null on the last page.

    Args:
        agent_id (str):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryAgentsByIdVersionsResponse200 | GetApiGovernanceRegistryAgentsByIdVersionsResponse400 | GetApiGovernanceRegistryAgentsByIdVersionsResponse401 | GetApiGovernanceRegistryAgentsByIdVersionsResponse403 | GetApiGovernanceRegistryAgentsByIdVersionsResponse404 | GetApiGovernanceRegistryAgentsByIdVersionsResponse422 | GetApiGovernanceRegistryAgentsByIdVersionsResponse500]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse400
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse401
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse403
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse404
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse422
    | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
    | None
):
    """List one registry agent's versions

     The change events recorded for the agent, oldest first, one page at a time. Each carries
    `from_version`, `to_version` and the entry as it stood at `to_version`. Pass `next_cursor` back as
    `cursor` for the next page; it is null on the last page.

    Args:
        agent_id (str):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200 | GetApiGovernanceRegistryAgentsByIdVersionsResponse400 | GetApiGovernanceRegistryAgentsByIdVersionsResponse401 | GetApiGovernanceRegistryAgentsByIdVersionsResponse403 | GetApiGovernanceRegistryAgentsByIdVersionsResponse404 | GetApiGovernanceRegistryAgentsByIdVersionsResponse422 | GetApiGovernanceRegistryAgentsByIdVersionsResponse500
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
