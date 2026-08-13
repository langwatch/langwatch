from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_webhook_event_body import GetWebhookEventBody
from ...models.get_webhook_event_response_200 import GetWebhookEventResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: GetWebhookEventBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/events.get",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetWebhookEventResponse200 | None:
    if response.status_code == 200:
        response_200 = GetWebhookEventResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetWebhookEventResponse200]:
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
    body: GetWebhookEventBody | Unset = UNSET,
) -> Response[GetWebhookEventResponse200]:
    """One emitted event by its id, as it was delivered. Serves the same families the events log serves. A
    404 covers every reason the log cannot answer — never emitted, past the retention horizon, or
    belonging to another organization — because telling those apart would confirm the existence of
    another tenant's request ids.

    Args:
        body (GetWebhookEventBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetWebhookEventResponse200]
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
    body: GetWebhookEventBody | Unset = UNSET,
) -> GetWebhookEventResponse200 | None:
    """One emitted event by its id, as it was delivered. Serves the same families the events log serves. A
    404 covers every reason the log cannot answer — never emitted, past the retention horizon, or
    belonging to another organization — because telling those apart would confirm the existence of
    another tenant's request ids.

    Args:
        body (GetWebhookEventBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetWebhookEventResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: GetWebhookEventBody | Unset = UNSET,
) -> Response[GetWebhookEventResponse200]:
    """One emitted event by its id, as it was delivered. Serves the same families the events log serves. A
    404 covers every reason the log cannot answer — never emitted, past the retention horizon, or
    belonging to another organization — because telling those apart would confirm the existence of
    another tenant's request ids.

    Args:
        body (GetWebhookEventBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetWebhookEventResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: GetWebhookEventBody | Unset = UNSET,
) -> GetWebhookEventResponse200 | None:
    """One emitted event by its id, as it was delivered. Serves the same families the events log serves. A
    404 covers every reason the log cannot answer — never emitted, past the retention horizon, or
    belonging to another organization — because telling those apart would confirm the existence of
    another tenant's request ids.

    Args:
        body (GetWebhookEventBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetWebhookEventResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
