from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_400 import (
    DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400,
)
from ...models.delete_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_401 import (
    DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401,
)
from ...models.delete_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_403 import (
    DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403,
)
from ...models.delete_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_404 import (
    DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404,
)
from ...models.delete_api_dashboards_by_dashboard_id_widgets_by_widget_id_response_500 import (
    DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    dashboard_id: str,
    widget_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/dashboards/{dashboard_id}/widgets/{widget_id}".format(
            dashboard_id=quote(str(dashboard_id), safe=""),
            widget_id=quote(str(widget_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    Any
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = response.json()
        return response_200

    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
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
) -> Response[
    Any
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
]:
    """Delete a widget on a board

     Deletes one widget on this board. Answers 204 with no body.

    Args:
        dashboard_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
        widget_id=widget_id,
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
) -> (
    Any
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    | None
):
    """Delete a widget on a board

     Deletes one widget on this board. Answers 204 with no body.

    Args:
        dashboard_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    """

    return sync_detailed(
        dashboard_id=dashboard_id,
        widget_id=widget_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    dashboard_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    Any
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
]:
    """Delete a widget on a board

     Deletes one widget on this board. Answers 204 with no body.

    Args:
        dashboard_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        dashboard_id=dashboard_id,
        widget_id=widget_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    dashboard_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    Any
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404
    | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    | None
):
    """Delete a widget on a board

     Deletes one widget on this board. Answers 204 with no body.

    Args:
        dashboard_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse400 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse401 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse403 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse404 | DeleteApiDashboardsByDashboardIdWidgetsByWidgetIdResponse500
    """

    return (
        await asyncio_detailed(
            dashboard_id=dashboard_id,
            widget_id=widget_id,
            client=client,
        )
    ).parsed
