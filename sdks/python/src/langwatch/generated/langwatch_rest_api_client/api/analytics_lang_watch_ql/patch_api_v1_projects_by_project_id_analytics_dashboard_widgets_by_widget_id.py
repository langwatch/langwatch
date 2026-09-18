from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody,
)
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_200 import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200,
)
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_400 import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400,
)
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_401 import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401,
)
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_403 import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403,
)
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_404 import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404,
)
from ...models.patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_response_500 import (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    widget_id: str,
    *,
    body: PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/projects/{project_id}/analytics/dashboard-widgets/{widget_id}".format(
            project_id=quote(str(project_id), safe=""),
            widget_id=quote(str(widget_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401.from_dict(
            response.json()
        )

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403.from_dict(
            response.json()
        )

        return response_403

    if response.status_code == 404:
        response_404 = PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404.from_dict(
            response.json()
        )

        return response_404

    if response.status_code == 500:
        response_500 = PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500.from_dict(
            response.json()
        )

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
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
    project_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody,
) -> Response[
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
]:
    """Update a dashboard widget

     Replaces a dashboard widget's name, its { code, queries } definition, or both. code and queries are
    rewritten together — the graph blob holds them as one — so a request that offers one without the
    other, or neither field at all, is refused.

    Args:
        project_id (str):
        widget_id (str):
        body (PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        widget_id=widget_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody,
) -> (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
    | None
):
    """Update a dashboard widget

     Replaces a dashboard widget's name, its { code, queries } definition, or both. code and queries are
    rewritten together — the graph blob holds them as one — so a request that offers one without the
    other, or neither field at all, is refused.

    Args:
        project_id (str):
        widget_id (str):
        body (PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
    """

    return sync_detailed(
        project_id=project_id,
        widget_id=widget_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody,
) -> Response[
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
]:
    """Update a dashboard widget

     Replaces a dashboard widget's name, its { code, queries } definition, or both. code and queries are
    rewritten together — the graph blob holds them as one — so a request that offers one without the
    other, or neither field at all, is refused.

    Args:
        project_id (str):
        widget_id (str):
        body (PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        widget_id=widget_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody,
) -> (
    PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404
    | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
    | None
):
    """Update a dashboard widget

     Replaces a dashboard widget's name, its { code, queries } definition, or both. code and queries are
    rewritten together — the graph blob holds them as one — so a request that offers one without the
    other, or neither field at all, is refused.

    Args:
        project_id (str):
        widget_id (str):
        body (PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse200 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse400 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse403 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse404 | PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            widget_id=widget_id,
            client=client,
            body=body,
        )
    ).parsed
