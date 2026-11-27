import datetime
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_ocsf_audit_response_200 import GetApiGovernanceOcsfAuditResponse200
from ...models.get_api_governance_ocsf_audit_response_400 import GetApiGovernanceOcsfAuditResponse400
from ...models.get_api_governance_ocsf_audit_response_401 import GetApiGovernanceOcsfAuditResponse401
from ...models.get_api_governance_ocsf_audit_response_403 import GetApiGovernanceOcsfAuditResponse403
from ...models.get_api_governance_ocsf_audit_response_422 import GetApiGovernanceOcsfAuditResponse422
from ...models.get_api_governance_ocsf_audit_response_500 import GetApiGovernanceOcsfAuditResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    json_since: str | Unset = UNSET
    if not isinstance(since, Unset):
        json_since = since.isoformat()
    params["since"] = json_since

    json_until: str | Unset = UNSET
    if not isinstance(until, Unset):
        json_until = until.isoformat()
    params["until"] = json_until

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/ocsf/audit",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceOcsfAuditResponse200
    | GetApiGovernanceOcsfAuditResponse400
    | GetApiGovernanceOcsfAuditResponse401
    | GetApiGovernanceOcsfAuditResponse403
    | GetApiGovernanceOcsfAuditResponse422
    | GetApiGovernanceOcsfAuditResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceOcsfAuditResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceOcsfAuditResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceOcsfAuditResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceOcsfAuditResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = GetApiGovernanceOcsfAuditResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceOcsfAuditResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceOcsfAuditResponse200
    | GetApiGovernanceOcsfAuditResponse400
    | GetApiGovernanceOcsfAuditResponse401
    | GetApiGovernanceOcsfAuditResponse403
    | GetApiGovernanceOcsfAuditResponse422
    | GetApiGovernanceOcsfAuditResponse500
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
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceOcsfAuditResponse200
    | GetApiGovernanceOcsfAuditResponse400
    | GetApiGovernanceOcsfAuditResponse401
    | GetApiGovernanceOcsfAuditResponse403
    | GetApiGovernanceOcsfAuditResponse422
    | GetApiGovernanceOcsfAuditResponse500
]:
    """Export the audit log as OCSF 1.9.0

     The organisation's audit log as OCSF 1.9.0 API Activity events, oldest first: who did what, on which
    target, from which address, and whether it failed. Pass `next_cursor` back as `cursor` to read on;
    it is always set, so a puller stores it between runs. `has_more` is true when more events are
    already waiting. `since` (ISO 8601 with an offset, 1970-01-01T00:00:00Z or later) starts the first
    read and a cursor carries its own position. `until` (same format and lower bound) is not in the
    cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceOcsfAuditResponse200 | GetApiGovernanceOcsfAuditResponse400 | GetApiGovernanceOcsfAuditResponse401 | GetApiGovernanceOcsfAuditResponse403 | GetApiGovernanceOcsfAuditResponse422 | GetApiGovernanceOcsfAuditResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceOcsfAuditResponse200
    | GetApiGovernanceOcsfAuditResponse400
    | GetApiGovernanceOcsfAuditResponse401
    | GetApiGovernanceOcsfAuditResponse403
    | GetApiGovernanceOcsfAuditResponse422
    | GetApiGovernanceOcsfAuditResponse500
    | None
):
    """Export the audit log as OCSF 1.9.0

     The organisation's audit log as OCSF 1.9.0 API Activity events, oldest first: who did what, on which
    target, from which address, and whether it failed. Pass `next_cursor` back as `cursor` to read on;
    it is always set, so a puller stores it between runs. `has_more` is true when more events are
    already waiting. `since` (ISO 8601 with an offset, 1970-01-01T00:00:00Z or later) starts the first
    read and a cursor carries its own position. `until` (same format and lower bound) is not in the
    cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceOcsfAuditResponse200 | GetApiGovernanceOcsfAuditResponse400 | GetApiGovernanceOcsfAuditResponse401 | GetApiGovernanceOcsfAuditResponse403 | GetApiGovernanceOcsfAuditResponse422 | GetApiGovernanceOcsfAuditResponse500
    """

    return sync_detailed(
        client=client,
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceOcsfAuditResponse200
    | GetApiGovernanceOcsfAuditResponse400
    | GetApiGovernanceOcsfAuditResponse401
    | GetApiGovernanceOcsfAuditResponse403
    | GetApiGovernanceOcsfAuditResponse422
    | GetApiGovernanceOcsfAuditResponse500
]:
    """Export the audit log as OCSF 1.9.0

     The organisation's audit log as OCSF 1.9.0 API Activity events, oldest first: who did what, on which
    target, from which address, and whether it failed. Pass `next_cursor` back as `cursor` to read on;
    it is always set, so a puller stores it between runs. `has_more` is true when more events are
    already waiting. `since` (ISO 8601 with an offset, 1970-01-01T00:00:00Z or later) starts the first
    read and a cursor carries its own position. `until` (same format and lower bound) is not in the
    cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceOcsfAuditResponse200 | GetApiGovernanceOcsfAuditResponse400 | GetApiGovernanceOcsfAuditResponse401 | GetApiGovernanceOcsfAuditResponse403 | GetApiGovernanceOcsfAuditResponse422 | GetApiGovernanceOcsfAuditResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> (
    GetApiGovernanceOcsfAuditResponse200
    | GetApiGovernanceOcsfAuditResponse400
    | GetApiGovernanceOcsfAuditResponse401
    | GetApiGovernanceOcsfAuditResponse403
    | GetApiGovernanceOcsfAuditResponse422
    | GetApiGovernanceOcsfAuditResponse500
    | None
):
    """Export the audit log as OCSF 1.9.0

     The organisation's audit log as OCSF 1.9.0 API Activity events, oldest first: who did what, on which
    target, from which address, and whether it failed. Pass `next_cursor` back as `cursor` to read on;
    it is always set, so a puller stores it between runs. `has_more` is true when more events are
    already waiting. `since` (ISO 8601 with an offset, 1970-01-01T00:00:00Z or later) starts the first
    read and a cursor carries its own position. `until` (same format and lower bound) is not in the
    cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceOcsfAuditResponse200 | GetApiGovernanceOcsfAuditResponse400 | GetApiGovernanceOcsfAuditResponse401 | GetApiGovernanceOcsfAuditResponse403 | GetApiGovernanceOcsfAuditResponse422 | GetApiGovernanceOcsfAuditResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            since=since,
            until=until,
            cursor=cursor,
        )
    ).parsed
