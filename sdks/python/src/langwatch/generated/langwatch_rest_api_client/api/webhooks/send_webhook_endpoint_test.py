from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.send_webhook_endpoint_test_body import SendWebhookEndpointTestBody
from ...models.send_webhook_endpoint_test_response_200 import SendWebhookEndpointTestResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: SendWebhookEndpointTestBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/endpoints.test",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> SendWebhookEndpointTestResponse200 | None:
    if response.status_code == 200:
        response_200 = SendWebhookEndpointTestResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[SendWebhookEndpointTestResponse200]:
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
    body: SendWebhookEndpointTestBody | Unset = UNSET,
) -> Response[SendWebhookEndpointTestResponse200]:
    """Send a signed test event through the full delivery path. Contract: this answers 200 whenever the
    test itself ran; `data.delivered` says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        body (SendWebhookEndpointTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[SendWebhookEndpointTestResponse200]
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
    body: SendWebhookEndpointTestBody | Unset = UNSET,
) -> SendWebhookEndpointTestResponse200 | None:
    """Send a signed test event through the full delivery path. Contract: this answers 200 whenever the
    test itself ran; `data.delivered` says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        body (SendWebhookEndpointTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        SendWebhookEndpointTestResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: SendWebhookEndpointTestBody | Unset = UNSET,
) -> Response[SendWebhookEndpointTestResponse200]:
    """Send a signed test event through the full delivery path. Contract: this answers 200 whenever the
    test itself ran; `data.delivered` says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        body (SendWebhookEndpointTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[SendWebhookEndpointTestResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: SendWebhookEndpointTestBody | Unset = UNSET,
) -> SendWebhookEndpointTestResponse200 | None:
    """Send a signed test event through the full delivery path. Contract: this answers 200 whenever the
    test itself ran; `data.delivered` says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        body (SendWebhookEndpointTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        SendWebhookEndpointTestResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
