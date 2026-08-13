from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_webhook_endpoint_health_body import GetWebhookEndpointHealthBody
from ...models.get_webhook_endpoint_health_response_200 import GetWebhookEndpointHealthResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: GetWebhookEndpointHealthBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/endpoints.getHealth",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetWebhookEndpointHealthResponse200 | None:
    if response.status_code == 200:
        response_200 = GetWebhookEndpointHealthResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetWebhookEndpointHealthResponse200]:
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
    body: GetWebhookEndpointHealthBody | Unset = UNSET,
) -> Response[GetWebhookEndpointHealthResponse200]:
    """Delivery health. The headline number is `oldest_undelivered_age_ms`, the feed's staleness: age of
    the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends per minute,
    success rate, and p95 latency over the last hour.

    Args:
        body (GetWebhookEndpointHealthBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetWebhookEndpointHealthResponse200]
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
    body: GetWebhookEndpointHealthBody | Unset = UNSET,
) -> GetWebhookEndpointHealthResponse200 | None:
    """Delivery health. The headline number is `oldest_undelivered_age_ms`, the feed's staleness: age of
    the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends per minute,
    success rate, and p95 latency over the last hour.

    Args:
        body (GetWebhookEndpointHealthBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetWebhookEndpointHealthResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: GetWebhookEndpointHealthBody | Unset = UNSET,
) -> Response[GetWebhookEndpointHealthResponse200]:
    """Delivery health. The headline number is `oldest_undelivered_age_ms`, the feed's staleness: age of
    the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends per minute,
    success rate, and p95 latency over the last hour.

    Args:
        body (GetWebhookEndpointHealthBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetWebhookEndpointHealthResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: GetWebhookEndpointHealthBody | Unset = UNSET,
) -> GetWebhookEndpointHealthResponse200 | None:
    """Delivery health. The headline number is `oldest_undelivered_age_ms`, the feed's staleness: age of
    the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends per minute,
    success rate, and p95 latency over the last hour.

    Args:
        body (GetWebhookEndpointHealthBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetWebhookEndpointHealthResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
