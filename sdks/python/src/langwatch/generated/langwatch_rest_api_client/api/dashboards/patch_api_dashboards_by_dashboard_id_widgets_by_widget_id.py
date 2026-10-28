from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody,
)
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_200 import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200,
)
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_400 import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400,
)
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_401 import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401,
)
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_403 import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403,
)
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_404 import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404,
)
from ...models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_500 import (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    dashboard_id: str,
    widget_id: str,
    *,
    body: PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/dashboards/{dashboard_id}/widgets/{widget_id}".format(
            dashboard_id=quote(str(dashboard_id), safe=""),
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
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
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
    dashboard_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody,
) -> Response[
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
]:
    """Update a widget on a dashboard

     Changes a widget's name, code, queries, description, source or excludedOrigins (its Langy traces
    setting). A field the body leaves out keeps its stored value. A body with none of these fields is
    refused.

    Args:
        dashboard_id (str):
        widget_id (str):
        body (PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
        widget_id=widget_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    dashboard_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody,
) -> (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    | None
):
    """Update a widget on a dashboard

     Changes a widget's name, code, queries, description, source or excludedOrigins (its Langy traces
    setting). A field the body leaves out keeps its stored value. A body with none of these fields is
    refused.

    Args:
        dashboard_id (str):
        widget_id (str):
        body (PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    """

    return sync_detailed(
        dashboard_id=dashboard_id,
        widget_id=widget_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    dashboard_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody,
) -> Response[
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
]:
    """Update a widget on a dashboard

     Changes a widget's name, code, queries, description, source or excludedOrigins (its Langy traces
    setting). A field the body leaves out keeps its stored value. A body with none of these fields is
    refused.

    Args:
        dashboard_id (str):
        widget_id (str):
        body (PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
        widget_id=widget_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    dashboard_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody,
) -> (
    PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    | None
):
    """Update a widget on a dashboard

     Changes a widget's name, code, queries, description, source or excludedOrigins (its Langy traces
    setting). A field the body leaves out keeps its stored value. A body with none of these fields is
    refused.

    Args:
        dashboard_id (str):
        widget_id (str):
        body (PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse200 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    """

    return (
        await asyncio_detailed(
            dashboard_id=dashboard_id,
            widget_id=widget_id,
            client=client,
            body=body,
        )
    ).parsed
