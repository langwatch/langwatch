from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_analytics_reports_body import PostApiV1AnalyticsReportsBody
from ...models.post_api_v1_analytics_reports_response_201 import PostApiV1AnalyticsReportsResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiV1AnalyticsReportsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/analytics/reports",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiV1AnalyticsReportsResponse201 | None:
    if response.status_code == 201:
        response_201 = PostApiV1AnalyticsReportsResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiV1AnalyticsReportsResponse201]:
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
    body: PostApiV1AnalyticsReportsBody,
) -> Response[PostApiV1AnalyticsReportsResponse201]:
    """Create a new dashboard The Analytics Reports boards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        body (PostApiV1AnalyticsReportsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1AnalyticsReportsResponse201]
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
    body: PostApiV1AnalyticsReportsBody,
) -> PostApiV1AnalyticsReportsResponse201 | None:
    """Create a new dashboard The Analytics Reports boards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        body (PostApiV1AnalyticsReportsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1AnalyticsReportsResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1AnalyticsReportsBody,
) -> Response[PostApiV1AnalyticsReportsResponse201]:
    """Create a new dashboard The Analytics Reports boards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        body (PostApiV1AnalyticsReportsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1AnalyticsReportsResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiV1AnalyticsReportsBody,
) -> PostApiV1AnalyticsReportsResponse201 | None:
    """Create a new dashboard The Analytics Reports boards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        body (PostApiV1AnalyticsReportsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1AnalyticsReportsResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
