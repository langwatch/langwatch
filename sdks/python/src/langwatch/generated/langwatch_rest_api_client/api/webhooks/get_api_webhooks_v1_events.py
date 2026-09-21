from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_webhooks_v1_events_response_200 import GetApiWebhooksV1EventsResponse200
from ...models.get_api_webhooks_v1_events_response_400 import GetApiWebhooksV1EventsResponse400
from ...models.get_api_webhooks_v1_events_response_401 import GetApiWebhooksV1EventsResponse401
from ...models.get_api_webhooks_v1_events_response_403 import GetApiWebhooksV1EventsResponse403
from ...models.get_api_webhooks_v1_events_response_500 import GetApiWebhooksV1EventsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    type_: str | Unset = UNSET,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["type"] = type_

    params["from"] = from_

    params["to"] = to

    params["cursor"] = cursor

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/webhooks/v1/events",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiWebhooksV1EventsResponse200
    | GetApiWebhooksV1EventsResponse400
    | GetApiWebhooksV1EventsResponse401
    | GetApiWebhooksV1EventsResponse403
    | GetApiWebhooksV1EventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiWebhooksV1EventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiWebhooksV1EventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiWebhooksV1EventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiWebhooksV1EventsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiWebhooksV1EventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiWebhooksV1EventsResponse200
    | GetApiWebhooksV1EventsResponse400
    | GetApiWebhooksV1EventsResponse401
    | GetApiWebhooksV1EventsResponse403
    | GetApiWebhooksV1EventsResponse500
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
    type_: str | Unset = UNSET,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[
    GetApiWebhooksV1EventsResponse200
    | GetApiWebhooksV1EventsResponse400
    | GetApiWebhooksV1EventsResponse401
    | GetApiWebhooksV1EventsResponse403
    | GetApiWebhooksV1EventsResponse500
]:
    """List emitted events

     The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        type_ (str | Unset):
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiWebhooksV1EventsResponse200 | GetApiWebhooksV1EventsResponse400 | GetApiWebhooksV1EventsResponse401 | GetApiWebhooksV1EventsResponse403 | GetApiWebhooksV1EventsResponse500]
    """

    kwargs = _get_kwargs(
        type_=type_,
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    type_: str | Unset = UNSET,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> (
    GetApiWebhooksV1EventsResponse200
    | GetApiWebhooksV1EventsResponse400
    | GetApiWebhooksV1EventsResponse401
    | GetApiWebhooksV1EventsResponse403
    | GetApiWebhooksV1EventsResponse500
    | None
):
    """List emitted events

     The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        type_ (str | Unset):
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiWebhooksV1EventsResponse200 | GetApiWebhooksV1EventsResponse400 | GetApiWebhooksV1EventsResponse401 | GetApiWebhooksV1EventsResponse403 | GetApiWebhooksV1EventsResponse500
    """

    return sync_detailed(
        client=client,
        type_=type_,
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    type_: str | Unset = UNSET,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[
    GetApiWebhooksV1EventsResponse200
    | GetApiWebhooksV1EventsResponse400
    | GetApiWebhooksV1EventsResponse401
    | GetApiWebhooksV1EventsResponse403
    | GetApiWebhooksV1EventsResponse500
]:
    """List emitted events

     The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        type_ (str | Unset):
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiWebhooksV1EventsResponse200 | GetApiWebhooksV1EventsResponse400 | GetApiWebhooksV1EventsResponse401 | GetApiWebhooksV1EventsResponse403 | GetApiWebhooksV1EventsResponse500]
    """

    kwargs = _get_kwargs(
        type_=type_,
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    type_: str | Unset = UNSET,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> (
    GetApiWebhooksV1EventsResponse200
    | GetApiWebhooksV1EventsResponse400
    | GetApiWebhooksV1EventsResponse401
    | GetApiWebhooksV1EventsResponse403
    | GetApiWebhooksV1EventsResponse500
    | None
):
    """List emitted events

     The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        type_ (str | Unset):
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiWebhooksV1EventsResponse200 | GetApiWebhooksV1EventsResponse400 | GetApiWebhooksV1EventsResponse401 | GetApiWebhooksV1EventsResponse403 | GetApiWebhooksV1EventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            type_=type_,
            from_=from_,
            to=to,
            cursor=cursor,
            limit=limit,
        )
    ).parsed
