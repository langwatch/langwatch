import datetime
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_ocsf_events_response_200 import GetApiGovernanceOcsfEventsResponse200
from ...models.get_api_governance_ocsf_events_response_400 import GetApiGovernanceOcsfEventsResponse400
from ...models.get_api_governance_ocsf_events_response_401 import GetApiGovernanceOcsfEventsResponse401
from ...models.get_api_governance_ocsf_events_response_403 import GetApiGovernanceOcsfEventsResponse403
from ...models.get_api_governance_ocsf_events_response_422 import GetApiGovernanceOcsfEventsResponse422
from ...models.get_api_governance_ocsf_events_response_500 import GetApiGovernanceOcsfEventsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    source_type: str | Unset = UNSET,
    source_id: str | Unset = UNSET,
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

    params["source_type"] = source_type

    params["source_id"] = source_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/ocsf/events",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceOcsfEventsResponse200
    | GetApiGovernanceOcsfEventsResponse400
    | GetApiGovernanceOcsfEventsResponse401
    | GetApiGovernanceOcsfEventsResponse403
    | GetApiGovernanceOcsfEventsResponse422
    | GetApiGovernanceOcsfEventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceOcsfEventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceOcsfEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceOcsfEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceOcsfEventsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = GetApiGovernanceOcsfEventsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceOcsfEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceOcsfEventsResponse200
    | GetApiGovernanceOcsfEventsResponse400
    | GetApiGovernanceOcsfEventsResponse401
    | GetApiGovernanceOcsfEventsResponse403
    | GetApiGovernanceOcsfEventsResponse422
    | GetApiGovernanceOcsfEventsResponse500
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
    source_type: str | Unset = UNSET,
    source_id: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceOcsfEventsResponse200
    | GetApiGovernanceOcsfEventsResponse400
    | GetApiGovernanceOcsfEventsResponse401
    | GetApiGovernanceOcsfEventsResponse403
    | GetApiGovernanceOcsfEventsResponse422
    | GetApiGovernanceOcsfEventsResponse500
]:
    """Export governance events as OCSF 1.9.0

     The organisation's governance events as OCSF 1.9.0 API Activity (6003) events, oldest first: traces
    from ingestion sources, events pulled from provider audit APIs, admin workspace views and OCSF
    events pushed in from other sources (`source_type` `ocsf_push`, returned as received). Each
    LangWatch event carries `ai_model`, `ai_agent` and `message_context` token counts when known, and
    the cost under `unmapped.langwatch`. Filter with `source_type` and `source_id`. Pass `next_cursor`
    back as `cursor` to read on; it is always set, so a puller stores it between runs. `has_more` is
    true when more events are already waiting. `since` (ISO 8601) starts the first read and a cursor
    carries its own position. `until` (ISO 8601) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        source_type (str | Unset):
        source_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceOcsfEventsResponse200 | GetApiGovernanceOcsfEventsResponse400 | GetApiGovernanceOcsfEventsResponse401 | GetApiGovernanceOcsfEventsResponse403 | GetApiGovernanceOcsfEventsResponse422 | GetApiGovernanceOcsfEventsResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
        source_type=source_type,
        source_id=source_id,
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
    source_type: str | Unset = UNSET,
    source_id: str | Unset = UNSET,
) -> (
    GetApiGovernanceOcsfEventsResponse200
    | GetApiGovernanceOcsfEventsResponse400
    | GetApiGovernanceOcsfEventsResponse401
    | GetApiGovernanceOcsfEventsResponse403
    | GetApiGovernanceOcsfEventsResponse422
    | GetApiGovernanceOcsfEventsResponse500
    | None
):
    """Export governance events as OCSF 1.9.0

     The organisation's governance events as OCSF 1.9.0 API Activity (6003) events, oldest first: traces
    from ingestion sources, events pulled from provider audit APIs, admin workspace views and OCSF
    events pushed in from other sources (`source_type` `ocsf_push`, returned as received). Each
    LangWatch event carries `ai_model`, `ai_agent` and `message_context` token counts when known, and
    the cost under `unmapped.langwatch`. Filter with `source_type` and `source_id`. Pass `next_cursor`
    back as `cursor` to read on; it is always set, so a puller stores it between runs. `has_more` is
    true when more events are already waiting. `since` (ISO 8601) starts the first read and a cursor
    carries its own position. `until` (ISO 8601) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        source_type (str | Unset):
        source_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceOcsfEventsResponse200 | GetApiGovernanceOcsfEventsResponse400 | GetApiGovernanceOcsfEventsResponse401 | GetApiGovernanceOcsfEventsResponse403 | GetApiGovernanceOcsfEventsResponse422 | GetApiGovernanceOcsfEventsResponse500
    """

    return sync_detailed(
        client=client,
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
        source_type=source_type,
        source_id=source_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    source_type: str | Unset = UNSET,
    source_id: str | Unset = UNSET,
) -> Response[
    GetApiGovernanceOcsfEventsResponse200
    | GetApiGovernanceOcsfEventsResponse400
    | GetApiGovernanceOcsfEventsResponse401
    | GetApiGovernanceOcsfEventsResponse403
    | GetApiGovernanceOcsfEventsResponse422
    | GetApiGovernanceOcsfEventsResponse500
]:
    """Export governance events as OCSF 1.9.0

     The organisation's governance events as OCSF 1.9.0 API Activity (6003) events, oldest first: traces
    from ingestion sources, events pulled from provider audit APIs, admin workspace views and OCSF
    events pushed in from other sources (`source_type` `ocsf_push`, returned as received). Each
    LangWatch event carries `ai_model`, `ai_agent` and `message_context` token counts when known, and
    the cost under `unmapped.langwatch`. Filter with `source_type` and `source_id`. Pass `next_cursor`
    back as `cursor` to read on; it is always set, so a puller stores it between runs. `has_more` is
    true when more events are already waiting. `since` (ISO 8601) starts the first read and a cursor
    carries its own position. `until` (ISO 8601) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        source_type (str | Unset):
        source_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceOcsfEventsResponse200 | GetApiGovernanceOcsfEventsResponse400 | GetApiGovernanceOcsfEventsResponse401 | GetApiGovernanceOcsfEventsResponse403 | GetApiGovernanceOcsfEventsResponse422 | GetApiGovernanceOcsfEventsResponse500]
    """

    kwargs = _get_kwargs(
        limit=limit,
        since=since,
        until=until,
        cursor=cursor,
        source_type=source_type,
        source_id=source_id,
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
    source_type: str | Unset = UNSET,
    source_id: str | Unset = UNSET,
) -> (
    GetApiGovernanceOcsfEventsResponse200
    | GetApiGovernanceOcsfEventsResponse400
    | GetApiGovernanceOcsfEventsResponse401
    | GetApiGovernanceOcsfEventsResponse403
    | GetApiGovernanceOcsfEventsResponse422
    | GetApiGovernanceOcsfEventsResponse500
    | None
):
    """Export governance events as OCSF 1.9.0

     The organisation's governance events as OCSF 1.9.0 API Activity (6003) events, oldest first: traces
    from ingestion sources, events pulled from provider audit APIs, admin workspace views and OCSF
    events pushed in from other sources (`source_type` `ocsf_push`, returned as received). Each
    LangWatch event carries `ai_model`, `ai_agent` and `message_context` token counts when known, and
    the cost under `unmapped.langwatch`. Filter with `source_type` and `source_id`. Pass `next_cursor`
    back as `cursor` to read on; it is always set, so a puller stores it between runs. `has_more` is
    true when more events are already waiting. `since` (ISO 8601) starts the first read and a cursor
    carries its own position. `until` (ISO 8601) is not in the cursor: send it with every page.

    Args:
        limit (int | Unset):  Default: 500.
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        cursor (str | Unset):
        source_type (str | Unset):
        source_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceOcsfEventsResponse200 | GetApiGovernanceOcsfEventsResponse400 | GetApiGovernanceOcsfEventsResponse401 | GetApiGovernanceOcsfEventsResponse403 | GetApiGovernanceOcsfEventsResponse422 | GetApiGovernanceOcsfEventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            since=since,
            until=until,
            cursor=cursor,
            source_type=source_type,
            source_id=source_id,
        )
    ).parsed
