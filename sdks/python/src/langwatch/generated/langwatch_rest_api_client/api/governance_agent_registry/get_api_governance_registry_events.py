from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_registry_events_response_200 import GetApiGovernanceRegistryEventsResponse200
from ...models.get_api_governance_registry_events_response_400 import GetApiGovernanceRegistryEventsResponse400
from ...models.get_api_governance_registry_events_response_401 import GetApiGovernanceRegistryEventsResponse401
from ...models.get_api_governance_registry_events_response_403 import GetApiGovernanceRegistryEventsResponse403
from ...models.get_api_governance_registry_events_response_422 import GetApiGovernanceRegistryEventsResponse422
from ...models.get_api_governance_registry_events_response_500 import GetApiGovernanceRegistryEventsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
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
        "url": "/api/v1/governance/registry/events",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceRegistryEventsResponse200
    | GetApiGovernanceRegistryEventsResponse400
    | GetApiGovernanceRegistryEventsResponse401
    | GetApiGovernanceRegistryEventsResponse403
    | GetApiGovernanceRegistryEventsResponse422
    | GetApiGovernanceRegistryEventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceRegistryEventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceRegistryEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceRegistryEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceRegistryEventsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = GetApiGovernanceRegistryEventsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceRegistryEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceRegistryEventsResponse200
    | GetApiGovernanceRegistryEventsResponse400
    | GetApiGovernanceRegistryEventsResponse401
    | GetApiGovernanceRegistryEventsResponse403
    | GetApiGovernanceRegistryEventsResponse422
    | GetApiGovernanceRegistryEventsResponse500
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
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceRegistryEventsResponse200
    | GetApiGovernanceRegistryEventsResponse400
    | GetApiGovernanceRegistryEventsResponse401
    | GetApiGovernanceRegistryEventsResponse403
    | GetApiGovernanceRegistryEventsResponse422
    | GetApiGovernanceRegistryEventsResponse500
]:
    """Read the registry change feed

     The organisation's registry events in order: `governance.agent.registered`, `.versioned`,
    `.tool_deprecated`, `.removed` and `.flagged_shadow`. Pass the last `sequence` read as `cursor`; the
    same events are pushed to webhook endpoints subscribed to `governance.agent.*`.

    Args:
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryEventsResponse200 | GetApiGovernanceRegistryEventsResponse400 | GetApiGovernanceRegistryEventsResponse401 | GetApiGovernanceRegistryEventsResponse403 | GetApiGovernanceRegistryEventsResponse422 | GetApiGovernanceRegistryEventsResponse500]
    """

    kwargs = _get_kwargs(
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
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceRegistryEventsResponse200
    | GetApiGovernanceRegistryEventsResponse400
    | GetApiGovernanceRegistryEventsResponse401
    | GetApiGovernanceRegistryEventsResponse403
    | GetApiGovernanceRegistryEventsResponse422
    | GetApiGovernanceRegistryEventsResponse500
    | None
):
    """Read the registry change feed

     The organisation's registry events in order: `governance.agent.registered`, `.versioned`,
    `.tool_deprecated`, `.removed` and `.flagged_shadow`. Pass the last `sequence` read as `cursor`; the
    same events are pushed to webhook endpoints subscribed to `governance.agent.*`.

    Args:
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryEventsResponse200 | GetApiGovernanceRegistryEventsResponse400 | GetApiGovernanceRegistryEventsResponse401 | GetApiGovernanceRegistryEventsResponse403 | GetApiGovernanceRegistryEventsResponse422 | GetApiGovernanceRegistryEventsResponse500
    """

    return sync_detailed(
        client=client,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceRegistryEventsResponse200
    | GetApiGovernanceRegistryEventsResponse400
    | GetApiGovernanceRegistryEventsResponse401
    | GetApiGovernanceRegistryEventsResponse403
    | GetApiGovernanceRegistryEventsResponse422
    | GetApiGovernanceRegistryEventsResponse500
]:
    """Read the registry change feed

     The organisation's registry events in order: `governance.agent.registered`, `.versioned`,
    `.tool_deprecated`, `.removed` and `.flagged_shadow`. Pass the last `sequence` read as `cursor`; the
    same events are pushed to webhook endpoints subscribed to `governance.agent.*`.

    Args:
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryEventsResponse200 | GetApiGovernanceRegistryEventsResponse400 | GetApiGovernanceRegistryEventsResponse401 | GetApiGovernanceRegistryEventsResponse403 | GetApiGovernanceRegistryEventsResponse422 | GetApiGovernanceRegistryEventsResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceRegistryEventsResponse200
    | GetApiGovernanceRegistryEventsResponse400
    | GetApiGovernanceRegistryEventsResponse401
    | GetApiGovernanceRegistryEventsResponse403
    | GetApiGovernanceRegistryEventsResponse422
    | GetApiGovernanceRegistryEventsResponse500
    | None
):
    """Read the registry change feed

     The organisation's registry events in order: `governance.agent.registered`, `.versioned`,
    `.tool_deprecated`, `.removed` and `.flagged_shadow`. Pass the last `sequence` read as `cursor`; the
    same events are pushed to webhook endpoints subscribed to `governance.agent.*`.

    Args:
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryEventsResponse200 | GetApiGovernanceRegistryEventsResponse400 | GetApiGovernanceRegistryEventsResponse401 | GetApiGovernanceRegistryEventsResponse403 | GetApiGovernanceRegistryEventsResponse422 | GetApiGovernanceRegistryEventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
