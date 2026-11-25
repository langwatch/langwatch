import datetime
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_ocsf_traces_response_200 import GetApiGovernanceOcsfTracesResponse200
from ...models.get_api_governance_ocsf_traces_response_400 import GetApiGovernanceOcsfTracesResponse400
from ...models.get_api_governance_ocsf_traces_response_401 import GetApiGovernanceOcsfTracesResponse401
from ...models.get_api_governance_ocsf_traces_response_403 import GetApiGovernanceOcsfTracesResponse403
from ...models.get_api_governance_ocsf_traces_response_422 import GetApiGovernanceOcsfTracesResponse422
from ...models.get_api_governance_ocsf_traces_response_500 import GetApiGovernanceOcsfTracesResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
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

    params["project_id"] = project_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/ocsf/traces",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceOcsfTracesResponse200
    | GetApiGovernanceOcsfTracesResponse400
    | GetApiGovernanceOcsfTracesResponse401
    | GetApiGovernanceOcsfTracesResponse403
    | GetApiGovernanceOcsfTracesResponse422
    | GetApiGovernanceOcsfTracesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceOcsfTracesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceOcsfTracesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceOcsfTracesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceOcsfTracesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = GetApiGovernanceOcsfTracesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceOcsfTracesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceOcsfTracesResponse200
    | GetApiGovernanceOcsfTracesResponse400
    | GetApiGovernanceOcsfTracesResponse401
    | GetApiGovernanceOcsfTracesResponse403
    | GetApiGovernanceOcsfTracesResponse422
    | GetApiGovernanceOcsfTracesResponse500
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
    project_id: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceOcsfTracesResponse200
    | GetApiGovernanceOcsfTracesResponse400
    | GetApiGovernanceOcsfTracesResponse401
    | GetApiGovernanceOcsfTracesResponse403
    | GetApiGovernanceOcsfTracesResponse422
    | GetApiGovernanceOcsfTracesResponse500
]:
    """Export project traces as OCSF 1.9.0

     The traces of the organisation's projects as OCSF 1.9.0 API Activity events, one per trace, with
    `ai_model`, `ai_agent`, token counts and cost. A trace updated again is exported again under the
    same `metadata.uid`; deduplicate on it. `project_id` limits the read to one project of the
    organisation. Pass `next_cursor` back as `cursor` to read on; it is always set, so a puller stores
    it between runs. `has_more` is true when more events are already waiting. `since` (ISO 8601 with an
    offset, 1970-01-01T00:00:00Z or later) starts the first read and a cursor carries its own position.
    `until` (same format and lower bound) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceOcsfTracesResponse200 | GetApiGovernanceOcsfTracesResponse400 | GetApiGovernanceOcsfTracesResponse401 | GetApiGovernanceOcsfTracesResponse403 | GetApiGovernanceOcsfTracesResponse422 | GetApiGovernanceOcsfTracesResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
        project_id=project_id,
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
    project_id: str | Unset = UNSET,
) -> (
    GetApiGovernanceOcsfTracesResponse200
    | GetApiGovernanceOcsfTracesResponse400
    | GetApiGovernanceOcsfTracesResponse401
    | GetApiGovernanceOcsfTracesResponse403
    | GetApiGovernanceOcsfTracesResponse422
    | GetApiGovernanceOcsfTracesResponse500
    | None
):
    """Export project traces as OCSF 1.9.0

     The traces of the organisation's projects as OCSF 1.9.0 API Activity events, one per trace, with
    `ai_model`, `ai_agent`, token counts and cost. A trace updated again is exported again under the
    same `metadata.uid`; deduplicate on it. `project_id` limits the read to one project of the
    organisation. Pass `next_cursor` back as `cursor` to read on; it is always set, so a puller stores
    it between runs. `has_more` is true when more events are already waiting. `since` (ISO 8601 with an
    offset, 1970-01-01T00:00:00Z or later) starts the first read and a cursor carries its own position.
    `until` (same format and lower bound) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceOcsfTracesResponse200 | GetApiGovernanceOcsfTracesResponse400 | GetApiGovernanceOcsfTracesResponse401 | GetApiGovernanceOcsfTracesResponse403 | GetApiGovernanceOcsfTracesResponse422 | GetApiGovernanceOcsfTracesResponse500
    """

    return sync_detailed(
        client=client,
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
        project_id=project_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceOcsfTracesResponse200
    | GetApiGovernanceOcsfTracesResponse400
    | GetApiGovernanceOcsfTracesResponse401
    | GetApiGovernanceOcsfTracesResponse403
    | GetApiGovernanceOcsfTracesResponse422
    | GetApiGovernanceOcsfTracesResponse500
]:
    """Export project traces as OCSF 1.9.0

     The traces of the organisation's projects as OCSF 1.9.0 API Activity events, one per trace, with
    `ai_model`, `ai_agent`, token counts and cost. A trace updated again is exported again under the
    same `metadata.uid`; deduplicate on it. `project_id` limits the read to one project of the
    organisation. Pass `next_cursor` back as `cursor` to read on; it is always set, so a puller stores
    it between runs. `has_more` is true when more events are already waiting. `since` (ISO 8601 with an
    offset, 1970-01-01T00:00:00Z or later) starts the first read and a cursor carries its own position.
    `until` (same format and lower bound) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceOcsfTracesResponse200 | GetApiGovernanceOcsfTracesResponse400 | GetApiGovernanceOcsfTracesResponse401 | GetApiGovernanceOcsfTracesResponse403 | GetApiGovernanceOcsfTracesResponse422 | GetApiGovernanceOcsfTracesResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
        project_id=project_id,
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
    project_id: str | Unset = UNSET,
) -> (
    GetApiGovernanceOcsfTracesResponse200
    | GetApiGovernanceOcsfTracesResponse400
    | GetApiGovernanceOcsfTracesResponse401
    | GetApiGovernanceOcsfTracesResponse403
    | GetApiGovernanceOcsfTracesResponse422
    | GetApiGovernanceOcsfTracesResponse500
    | None
):
    """Export project traces as OCSF 1.9.0

     The traces of the organisation's projects as OCSF 1.9.0 API Activity events, one per trace, with
    `ai_model`, `ai_agent`, token counts and cost. A trace updated again is exported again under the
    same `metadata.uid`; deduplicate on it. `project_id` limits the read to one project of the
    organisation. Pass `next_cursor` back as `cursor` to read on; it is always set, so a puller stores
    it between runs. `has_more` is true when more events are already waiting. `since` (ISO 8601 with an
    offset, 1970-01-01T00:00:00Z or later) starts the first read and a cursor carries its own position.
    `until` (same format and lower bound) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        project_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceOcsfTracesResponse200 | GetApiGovernanceOcsfTracesResponse400 | GetApiGovernanceOcsfTracesResponse401 | GetApiGovernanceOcsfTracesResponse403 | GetApiGovernanceOcsfTracesResponse422 | GetApiGovernanceOcsfTracesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            since=since,
            until=until,
            cursor=cursor,
            project_id=project_id,
        )
    ).parsed
