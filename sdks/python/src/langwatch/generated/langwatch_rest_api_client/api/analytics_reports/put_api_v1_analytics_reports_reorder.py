from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_v1_analytics_reports_reorder_body import PutApiV1AnalyticsReportsReorderBody
from ...models.put_api_v1_analytics_reports_reorder_response_200 import PutApiV1AnalyticsReportsReorderResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PutApiV1AnalyticsReportsReorderBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/analytics/reports/reorder",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PutApiV1AnalyticsReportsReorderResponse200 | None:
    if response.status_code == 200:
        response_200 = PutApiV1AnalyticsReportsReorderResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PutApiV1AnalyticsReportsReorderResponse200]:
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
    body: PutApiV1AnalyticsReportsReorderBody,
) -> Response[PutApiV1AnalyticsReportsReorderResponse200]:
    """Reorder dashboards by providing an ordered list of IDs

    Args:
        body (PutApiV1AnalyticsReportsReorderBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiV1AnalyticsReportsReorderResponse200]
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
    body: PutApiV1AnalyticsReportsReorderBody,
) -> PutApiV1AnalyticsReportsReorderResponse200 | None:
    """Reorder dashboards by providing an ordered list of IDs

    Args:
        body (PutApiV1AnalyticsReportsReorderBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiV1AnalyticsReportsReorderResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PutApiV1AnalyticsReportsReorderBody,
) -> Response[PutApiV1AnalyticsReportsReorderResponse200]:
    """Reorder dashboards by providing an ordered list of IDs

    Args:
        body (PutApiV1AnalyticsReportsReorderBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiV1AnalyticsReportsReorderResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PutApiV1AnalyticsReportsReorderBody,
) -> PutApiV1AnalyticsReportsReorderResponse200 | None:
    """Reorder dashboards by providing an ordered list of IDs

    Args:
        body (PutApiV1AnalyticsReportsReorderBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiV1AnalyticsReportsReorderResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
