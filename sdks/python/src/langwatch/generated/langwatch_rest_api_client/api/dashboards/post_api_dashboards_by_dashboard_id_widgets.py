from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dashboards_by_dashboard_id_widgets_body import PostApiDashboardsByDashboardIdWidgetsBody
from ...models.post_api_dashboards_by_dashboard_id_widgets_response_201 import (
    PostApiDashboardsByDashboardIdWidgetsResponse201,
)
from ...models.post_api_dashboards_by_dashboard_id_widgets_response_400 import (
    PostApiDashboardsByDashboardIdWidgetsResponse400,
)
from ...models.post_api_dashboards_by_dashboard_id_widgets_response_401 import (
    PostApiDashboardsByDashboardIdWidgetsResponse401,
)
from ...models.post_api_dashboards_by_dashboard_id_widgets_response_403 import (
    PostApiDashboardsByDashboardIdWidgetsResponse403,
)
from ...models.post_api_dashboards_by_dashboard_id_widgets_response_404 import (
    PostApiDashboardsByDashboardIdWidgetsResponse404,
)
from ...models.post_api_dashboards_by_dashboard_id_widgets_response_500 import (
    PostApiDashboardsByDashboardIdWidgetsResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    dashboard_id: str,
    *,
    body: PostApiDashboardsByDashboardIdWidgetsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dashboards/{dashboard_id}/widgets".format(
            dashboard_id=quote(str(dashboard_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiDashboardsByDashboardIdWidgetsResponse201
    | PostApiDashboardsByDashboardIdWidgetsResponse400
    | PostApiDashboardsByDashboardIdWidgetsResponse401
    | PostApiDashboardsByDashboardIdWidgetsResponse403
    | PostApiDashboardsByDashboardIdWidgetsResponse404
    | PostApiDashboardsByDashboardIdWidgetsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiDashboardsByDashboardIdWidgetsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiDashboardsByDashboardIdWidgetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiDashboardsByDashboardIdWidgetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiDashboardsByDashboardIdWidgetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiDashboardsByDashboardIdWidgetsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PostApiDashboardsByDashboardIdWidgetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiDashboardsByDashboardIdWidgetsResponse201
    | PostApiDashboardsByDashboardIdWidgetsResponse400
    | PostApiDashboardsByDashboardIdWidgetsResponse401
    | PostApiDashboardsByDashboardIdWidgetsResponse403
    | PostApiDashboardsByDashboardIdWidgetsResponse404
    | PostApiDashboardsByDashboardIdWidgetsResponse500
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
    *,
    client: AuthenticatedClient,
    body: PostApiDashboardsByDashboardIdWidgetsBody,
) -> Response[
    PostApiDashboardsByDashboardIdWidgetsResponse201
    | PostApiDashboardsByDashboardIdWidgetsResponse400
    | PostApiDashboardsByDashboardIdWidgetsResponse401
    | PostApiDashboardsByDashboardIdWidgetsResponse403
    | PostApiDashboardsByDashboardIdWidgetsResponse404
    | PostApiDashboardsByDashboardIdWidgetsResponse500
]:
    r"""Create a widget on a dashboard

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    dashboard at the next free row. `source` records where the widget came from; without it, the widget
    is recorded as made through the API. Each query's `sources` lists the trace origins it counts; a
    query that names none counts `[\"application\"]`.

    Args:
        dashboard_id (str):
        body (PostApiDashboardsByDashboardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDashboardsByDashboardIdWidgetsResponse201 | PostApiDashboardsByDashboardIdWidgetsResponse400 | PostApiDashboardsByDashboardIdWidgetsResponse401 | PostApiDashboardsByDashboardIdWidgetsResponse403 | PostApiDashboardsByDashboardIdWidgetsResponse404 | PostApiDashboardsByDashboardIdWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiDashboardsByDashboardIdWidgetsBody,
) -> (
    PostApiDashboardsByDashboardIdWidgetsResponse201
    | PostApiDashboardsByDashboardIdWidgetsResponse400
    | PostApiDashboardsByDashboardIdWidgetsResponse401
    | PostApiDashboardsByDashboardIdWidgetsResponse403
    | PostApiDashboardsByDashboardIdWidgetsResponse404
    | PostApiDashboardsByDashboardIdWidgetsResponse500
    | None
):
    r"""Create a widget on a dashboard

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    dashboard at the next free row. `source` records where the widget came from; without it, the widget
    is recorded as made through the API. Each query's `sources` lists the trace origins it counts; a
    query that names none counts `[\"application\"]`.

    Args:
        dashboard_id (str):
        body (PostApiDashboardsByDashboardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDashboardsByDashboardIdWidgetsResponse201 | PostApiDashboardsByDashboardIdWidgetsResponse400 | PostApiDashboardsByDashboardIdWidgetsResponse401 | PostApiDashboardsByDashboardIdWidgetsResponse403 | PostApiDashboardsByDashboardIdWidgetsResponse404 | PostApiDashboardsByDashboardIdWidgetsResponse500
    """

    return sync_detailed(
        dashboard_id=dashboard_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiDashboardsByDashboardIdWidgetsBody,
) -> Response[
    PostApiDashboardsByDashboardIdWidgetsResponse201
    | PostApiDashboardsByDashboardIdWidgetsResponse400
    | PostApiDashboardsByDashboardIdWidgetsResponse401
    | PostApiDashboardsByDashboardIdWidgetsResponse403
    | PostApiDashboardsByDashboardIdWidgetsResponse404
    | PostApiDashboardsByDashboardIdWidgetsResponse500
]:
    r"""Create a widget on a dashboard

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    dashboard at the next free row. `source` records where the widget came from; without it, the widget
    is recorded as made through the API. Each query's `sources` lists the trace origins it counts; a
    query that names none counts `[\"application\"]`.

    Args:
        dashboard_id (str):
        body (PostApiDashboardsByDashboardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDashboardsByDashboardIdWidgetsResponse201 | PostApiDashboardsByDashboardIdWidgetsResponse400 | PostApiDashboardsByDashboardIdWidgetsResponse401 | PostApiDashboardsByDashboardIdWidgetsResponse403 | PostApiDashboardsByDashboardIdWidgetsResponse404 | PostApiDashboardsByDashboardIdWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    dashboard_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiDashboardsByDashboardIdWidgetsBody,
) -> (
    PostApiDashboardsByDashboardIdWidgetsResponse201
    | PostApiDashboardsByDashboardIdWidgetsResponse400
    | PostApiDashboardsByDashboardIdWidgetsResponse401
    | PostApiDashboardsByDashboardIdWidgetsResponse403
    | PostApiDashboardsByDashboardIdWidgetsResponse404
    | PostApiDashboardsByDashboardIdWidgetsResponse500
    | None
):
    r"""Create a widget on a dashboard

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    dashboard at the next free row. `source` records where the widget came from; without it, the widget
    is recorded as made through the API. Each query's `sources` lists the trace origins it counts; a
    query that names none counts `[\"application\"]`.

    Args:
        dashboard_id (str):
        body (PostApiDashboardsByDashboardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDashboardsByDashboardIdWidgetsResponse201 | PostApiDashboardsByDashboardIdWidgetsResponse400 | PostApiDashboardsByDashboardIdWidgetsResponse401 | PostApiDashboardsByDashboardIdWidgetsResponse403 | PostApiDashboardsByDashboardIdWidgetsResponse404 | PostApiDashboardsByDashboardIdWidgetsResponse500
    """

    return (
        await asyncio_detailed(
            dashboard_id=dashboard_id,
            client=client,
            body=body,
        )
    ).parsed
