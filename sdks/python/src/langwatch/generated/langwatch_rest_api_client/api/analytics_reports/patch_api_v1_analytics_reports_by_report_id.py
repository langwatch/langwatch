from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_v1_analytics_reports_by_report_id_body import PatchApiV1AnalyticsReportsByReportIdBody
from ...models.patch_api_v1_analytics_reports_by_report_id_response_200 import (
    PatchApiV1AnalyticsReportsByReportIdResponse200,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    report_id: str,
    *,
    body: PatchApiV1AnalyticsReportsByReportIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/analytics/reports/{report_id}".format(
            report_id=quote(str(report_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PatchApiV1AnalyticsReportsByReportIdResponse200 | None:
    if response.status_code == 200:
        response_200 = PatchApiV1AnalyticsReportsByReportIdResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PatchApiV1AnalyticsReportsByReportIdResponse200]:
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
    report_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1AnalyticsReportsByReportIdBody,
) -> Response[PatchApiV1AnalyticsReportsByReportIdResponse200]:
    """Rename a dashboard The Analytics Reports dashboards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        report_id (str):
        body (PatchApiV1AnalyticsReportsByReportIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiV1AnalyticsReportsByReportIdResponse200]
    """

    kwargs = _get_kwargs(
        report_id=report_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    report_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1AnalyticsReportsByReportIdBody,
) -> PatchApiV1AnalyticsReportsByReportIdResponse200 | None:
    """Rename a dashboard The Analytics Reports dashboards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        report_id (str):
        body (PatchApiV1AnalyticsReportsByReportIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiV1AnalyticsReportsByReportIdResponse200
    """

    return sync_detailed(
        report_id=report_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    report_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1AnalyticsReportsByReportIdBody,
) -> Response[PatchApiV1AnalyticsReportsByReportIdResponse200]:
    """Rename a dashboard The Analytics Reports dashboards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        report_id (str):
        body (PatchApiV1AnalyticsReportsByReportIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiV1AnalyticsReportsByReportIdResponse200]
    """

    kwargs = _get_kwargs(
        report_id=report_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    report_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1AnalyticsReportsByReportIdBody,
) -> PatchApiV1AnalyticsReportsByReportIdResponse200 | None:
    """Rename a dashboard The Analytics Reports dashboards API is deprecated; use the Dashboards API at
    /api/v1/dashboards

    Args:
        report_id (str):
        body (PatchApiV1AnalyticsReportsByReportIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiV1AnalyticsReportsByReportIdResponse200
    """

    return (
        await asyncio_detailed(
            report_id=report_id,
            client=client,
            body=body,
        )
    ).parsed
