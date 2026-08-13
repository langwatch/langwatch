from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_webhook_events_body import ListWebhookEventsBody
from ...models.list_webhook_events_response_200 import ListWebhookEventsResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: ListWebhookEventsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/events.list",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListWebhookEventsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListWebhookEventsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListWebhookEventsResponse200]:
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
    body: ListWebhookEventsBody | Unset = UNSET,
) -> Response[ListWebhookEventsResponse200]:
    """The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        body (ListWebhookEventsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListWebhookEventsResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: ListWebhookEventsBody | Unset = UNSET,
) -> ListWebhookEventsResponse200 | None:
    """The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        body (ListWebhookEventsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListWebhookEventsResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ListWebhookEventsBody | Unset = UNSET,
) -> Response[ListWebhookEventsResponse200]:
    """The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        body (ListWebhookEventsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListWebhookEventsResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ListWebhookEventsBody | Unset = UNSET,
) -> ListWebhookEventsResponse200 | None:
    """The organization's emitted-events log for the request families: cursor-paged, newest first, filter
    by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from`
    must not be later than `to` — a range that ends before it starts is rejected rather than answered
    with an empty page. They are required because the log is a ranged read over the 13-month spend table
    and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only
    copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance
    families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained
    in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page
    rather than an error, so a client can probe forward-compatibly.

    Args:
        body (ListWebhookEventsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListWebhookEventsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
