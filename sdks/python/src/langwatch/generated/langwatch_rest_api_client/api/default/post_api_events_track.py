from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_events_track_response_200 import PostApiEventsTrackResponse200
from ...models.post_api_events_track_response_400 import PostApiEventsTrackResponse400
from ...models.post_api_events_track_response_401 import PostApiEventsTrackResponse401
from ...models.post_api_events_track_response_422 import PostApiEventsTrackResponse422
from ...models.post_api_events_track_response_500 import PostApiEventsTrackResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/events/track",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiEventsTrackResponse200
    | PostApiEventsTrackResponse400
    | PostApiEventsTrackResponse401
    | PostApiEventsTrackResponse422
    | PostApiEventsTrackResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiEventsTrackResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiEventsTrackResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiEventsTrackResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiEventsTrackResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiEventsTrackResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiEventsTrackResponse200
    | PostApiEventsTrackResponse400
    | PostApiEventsTrackResponse401
    | PostApiEventsTrackResponse422
    | PostApiEventsTrackResponse500
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
) -> Response[
    PostApiEventsTrackResponse200
    | PostApiEventsTrackResponse400
    | PostApiEventsTrackResponse401
    | PostApiEventsTrackResponse422
    | PostApiEventsTrackResponse500
]:
    """Record a user event (e.g. thumbs up/down, selected text) attached to a trace. Predefined event types
    validate against their schemas; custom event types pass through
    `trackEventRESTParamsValidatorSchema`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEventsTrackResponse200 | PostApiEventsTrackResponse400 | PostApiEventsTrackResponse401 | PostApiEventsTrackResponse422 | PostApiEventsTrackResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    PostApiEventsTrackResponse200
    | PostApiEventsTrackResponse400
    | PostApiEventsTrackResponse401
    | PostApiEventsTrackResponse422
    | PostApiEventsTrackResponse500
    | None
):
    """Record a user event (e.g. thumbs up/down, selected text) attached to a trace. Predefined event types
    validate against their schemas; custom event types pass through
    `trackEventRESTParamsValidatorSchema`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEventsTrackResponse200 | PostApiEventsTrackResponse400 | PostApiEventsTrackResponse401 | PostApiEventsTrackResponse422 | PostApiEventsTrackResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiEventsTrackResponse200
    | PostApiEventsTrackResponse400
    | PostApiEventsTrackResponse401
    | PostApiEventsTrackResponse422
    | PostApiEventsTrackResponse500
]:
    """Record a user event (e.g. thumbs up/down, selected text) attached to a trace. Predefined event types
    validate against their schemas; custom event types pass through
    `trackEventRESTParamsValidatorSchema`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEventsTrackResponse200 | PostApiEventsTrackResponse400 | PostApiEventsTrackResponse401 | PostApiEventsTrackResponse422 | PostApiEventsTrackResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    PostApiEventsTrackResponse200
    | PostApiEventsTrackResponse400
    | PostApiEventsTrackResponse401
    | PostApiEventsTrackResponse422
    | PostApiEventsTrackResponse500
    | None
):
    """Record a user event (e.g. thumbs up/down, selected text) attached to a trace. Predefined event types
    validate against their schemas; custom event types pass through
    `trackEventRESTParamsValidatorSchema`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEventsTrackResponse200 | PostApiEventsTrackResponse400 | PostApiEventsTrackResponse401 | PostApiEventsTrackResponse422 | PostApiEventsTrackResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
