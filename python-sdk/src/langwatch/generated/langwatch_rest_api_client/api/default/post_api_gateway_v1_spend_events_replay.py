from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_spend_events_replay_body import PostApiGatewayV1SpendEventsReplayBody
from ...models.post_api_gateway_v1_spend_events_replay_response_200 import PostApiGatewayV1SpendEventsReplayResponse200
from ...models.post_api_gateway_v1_spend_events_replay_response_400 import PostApiGatewayV1SpendEventsReplayResponse400
from ...models.post_api_gateway_v1_spend_events_replay_response_401 import PostApiGatewayV1SpendEventsReplayResponse401
from ...models.post_api_gateway_v1_spend_events_replay_response_403 import PostApiGatewayV1SpendEventsReplayResponse403
from ...models.post_api_gateway_v1_spend_events_replay_response_500 import PostApiGatewayV1SpendEventsReplayResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiGatewayV1SpendEventsReplayBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/spend-events/replay",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1SpendEventsReplayResponse200
    | PostApiGatewayV1SpendEventsReplayResponse400
    | PostApiGatewayV1SpendEventsReplayResponse401
    | PostApiGatewayV1SpendEventsReplayResponse403
    | PostApiGatewayV1SpendEventsReplayResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGatewayV1SpendEventsReplayResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGatewayV1SpendEventsReplayResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1SpendEventsReplayResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1SpendEventsReplayResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiGatewayV1SpendEventsReplayResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1SpendEventsReplayResponse200
    | PostApiGatewayV1SpendEventsReplayResponse400
    | PostApiGatewayV1SpendEventsReplayResponse401
    | PostApiGatewayV1SpendEventsReplayResponse403
    | PostApiGatewayV1SpendEventsReplayResponse500
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
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1SpendEventsReplayBody | Unset = UNSET,
) -> Response[
    PostApiGatewayV1SpendEventsReplayResponse200
    | PostApiGatewayV1SpendEventsReplayResponse400
    | PostApiGatewayV1SpendEventsReplayResponse401
    | PostApiGatewayV1SpendEventsReplayResponse403
    | PostApiGatewayV1SpendEventsReplayResponse500
]:
    """Re-delivers the window's spend envelopes to ONE endpoint through the normal delivery path (per-
    endpoint stream, retry ladder, delivery log), honoring the endpoint's event subscriptions. Envelope
    ids are UNCHANGED: your consumer's event-id dedup decides what a redelivery means. Mind your
    downstream billing system's finite dedup window (Metronome 34 days, Stripe 24h+): replaying older
    than that window can double-bill on your side, so prefer pull-and-diff for old ranges. The window is
    capped at 7 days and 10,000 envelopes per call; both caps are checked before any delivery is queued,
    so a refused replay ships nothing.

    Args:
        body (PostApiGatewayV1SpendEventsReplayBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1SpendEventsReplayResponse200 | PostApiGatewayV1SpendEventsReplayResponse400 | PostApiGatewayV1SpendEventsReplayResponse401 | PostApiGatewayV1SpendEventsReplayResponse403 | PostApiGatewayV1SpendEventsReplayResponse500]
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
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1SpendEventsReplayBody | Unset = UNSET,
) -> (
    PostApiGatewayV1SpendEventsReplayResponse200
    | PostApiGatewayV1SpendEventsReplayResponse400
    | PostApiGatewayV1SpendEventsReplayResponse401
    | PostApiGatewayV1SpendEventsReplayResponse403
    | PostApiGatewayV1SpendEventsReplayResponse500
    | None
):
    """Re-delivers the window's spend envelopes to ONE endpoint through the normal delivery path (per-
    endpoint stream, retry ladder, delivery log), honoring the endpoint's event subscriptions. Envelope
    ids are UNCHANGED: your consumer's event-id dedup decides what a redelivery means. Mind your
    downstream billing system's finite dedup window (Metronome 34 days, Stripe 24h+): replaying older
    than that window can double-bill on your side, so prefer pull-and-diff for old ranges. The window is
    capped at 7 days and 10,000 envelopes per call; both caps are checked before any delivery is queued,
    so a refused replay ships nothing.

    Args:
        body (PostApiGatewayV1SpendEventsReplayBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1SpendEventsReplayResponse200 | PostApiGatewayV1SpendEventsReplayResponse400 | PostApiGatewayV1SpendEventsReplayResponse401 | PostApiGatewayV1SpendEventsReplayResponse403 | PostApiGatewayV1SpendEventsReplayResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1SpendEventsReplayBody | Unset = UNSET,
) -> Response[
    PostApiGatewayV1SpendEventsReplayResponse200
    | PostApiGatewayV1SpendEventsReplayResponse400
    | PostApiGatewayV1SpendEventsReplayResponse401
    | PostApiGatewayV1SpendEventsReplayResponse403
    | PostApiGatewayV1SpendEventsReplayResponse500
]:
    """Re-delivers the window's spend envelopes to ONE endpoint through the normal delivery path (per-
    endpoint stream, retry ladder, delivery log), honoring the endpoint's event subscriptions. Envelope
    ids are UNCHANGED: your consumer's event-id dedup decides what a redelivery means. Mind your
    downstream billing system's finite dedup window (Metronome 34 days, Stripe 24h+): replaying older
    than that window can double-bill on your side, so prefer pull-and-diff for old ranges. The window is
    capped at 7 days and 10,000 envelopes per call; both caps are checked before any delivery is queued,
    so a refused replay ships nothing.

    Args:
        body (PostApiGatewayV1SpendEventsReplayBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1SpendEventsReplayResponse200 | PostApiGatewayV1SpendEventsReplayResponse400 | PostApiGatewayV1SpendEventsReplayResponse401 | PostApiGatewayV1SpendEventsReplayResponse403 | PostApiGatewayV1SpendEventsReplayResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1SpendEventsReplayBody | Unset = UNSET,
) -> (
    PostApiGatewayV1SpendEventsReplayResponse200
    | PostApiGatewayV1SpendEventsReplayResponse400
    | PostApiGatewayV1SpendEventsReplayResponse401
    | PostApiGatewayV1SpendEventsReplayResponse403
    | PostApiGatewayV1SpendEventsReplayResponse500
    | None
):
    """Re-delivers the window's spend envelopes to ONE endpoint through the normal delivery path (per-
    endpoint stream, retry ladder, delivery log), honoring the endpoint's event subscriptions. Envelope
    ids are UNCHANGED: your consumer's event-id dedup decides what a redelivery means. Mind your
    downstream billing system's finite dedup window (Metronome 34 days, Stripe 24h+): replaying older
    than that window can double-bill on your side, so prefer pull-and-diff for old ranges. The window is
    capped at 7 days and 10,000 envelopes per call; both caps are checked before any delivery is queued,
    so a refused replay ships nothing.

    Args:
        body (PostApiGatewayV1SpendEventsReplayBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1SpendEventsReplayResponse200 | PostApiGatewayV1SpendEventsReplayResponse400 | PostApiGatewayV1SpendEventsReplayResponse401 | PostApiGatewayV1SpendEventsReplayResponse403 | PostApiGatewayV1SpendEventsReplayResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
