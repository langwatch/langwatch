from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.update_webhook_endpoint_body import UpdateWebhookEndpointBody
from ...models.update_webhook_endpoint_response_200 import UpdateWebhookEndpointResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: UpdateWebhookEndpointBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/endpoints.update",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> UpdateWebhookEndpointResponse200 | None:
    if response.status_code == 200:
        response_200 = UpdateWebhookEndpointResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[UpdateWebhookEndpointResponse200]:
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
    body: UpdateWebhookEndpointBody | Unset = UNSET,
) -> Response[UpdateWebhookEndpointResponse200]:
    """Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). Partial: only the fields present
    are written.

    Args:
        body (UpdateWebhookEndpointBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateWebhookEndpointResponse200]
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
    body: UpdateWebhookEndpointBody | Unset = UNSET,
) -> UpdateWebhookEndpointResponse200 | None:
    """Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). Partial: only the fields present
    are written.

    Args:
        body (UpdateWebhookEndpointBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateWebhookEndpointResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: UpdateWebhookEndpointBody | Unset = UNSET,
) -> Response[UpdateWebhookEndpointResponse200]:
    """Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). Partial: only the fields present
    are written.

    Args:
        body (UpdateWebhookEndpointBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateWebhookEndpointResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: UpdateWebhookEndpointBody | Unset = UNSET,
) -> UpdateWebhookEndpointResponse200 | None:
    """Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). Partial: only the fields present
    are written.

    Args:
        body (UpdateWebhookEndpointBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateWebhookEndpointResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
