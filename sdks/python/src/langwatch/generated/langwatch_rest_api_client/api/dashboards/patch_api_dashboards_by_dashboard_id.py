from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_dashboards_by_dashboard_id_body import PatchApiDashboardsByDashboardIdBody
from ...models.patch_api_dashboards_by_dashboard_id_response_200 import PatchApiDashboardsByDashboardIdResponse200
from ...models.patch_api_dashboards_by_dashboard_id_response_400 import PatchApiDashboardsByDashboardIdResponse400
from ...models.patch_api_dashboards_by_dashboard_id_response_401 import PatchApiDashboardsByDashboardIdResponse401
from ...models.patch_api_dashboards_by_dashboard_id_response_403 import PatchApiDashboardsByDashboardIdResponse403
from ...models.patch_api_dashboards_by_dashboard_id_response_404 import PatchApiDashboardsByDashboardIdResponse404
from ...models.patch_api_dashboards_by_dashboard_id_response_500 import PatchApiDashboardsByDashboardIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    dashboard_id: str,
    *,
    body: PatchApiDashboardsByDashboardIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/dashboards/{dashboard_id}".format(
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
    PatchApiDashboardsByDashboardIdResponse200
    | PatchApiDashboardsByDashboardIdResponse400
    | PatchApiDashboardsByDashboardIdResponse401
    | PatchApiDashboardsByDashboardIdResponse403
    | PatchApiDashboardsByDashboardIdResponse404
    | PatchApiDashboardsByDashboardIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiDashboardsByDashboardIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiDashboardsByDashboardIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiDashboardsByDashboardIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiDashboardsByDashboardIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PatchApiDashboardsByDashboardIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PatchApiDashboardsByDashboardIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiDashboardsByDashboardIdResponse200
    | PatchApiDashboardsByDashboardIdResponse400
    | PatchApiDashboardsByDashboardIdResponse401
    | PatchApiDashboardsByDashboardIdResponse403
    | PatchApiDashboardsByDashboardIdResponse404
    | PatchApiDashboardsByDashboardIdResponse500
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
    body: PatchApiDashboardsByDashboardIdBody,
) -> Response[
    PatchApiDashboardsByDashboardIdResponse200
    | PatchApiDashboardsByDashboardIdResponse400
    | PatchApiDashboardsByDashboardIdResponse401
    | PatchApiDashboardsByDashboardIdResponse403
    | PatchApiDashboardsByDashboardIdResponse404
    | PatchApiDashboardsByDashboardIdResponse500
]:
    """Update a dashboard

     Changes a dashboard's name, description or the trace origins its widgets leave out; a field the body
    leaves out keeps its value. A null description clears it; excludedOrigins [] includes Langy's
    traces, and null restores the default (Langy's left out, none in a personal project).

    Args:
        dashboard_id (str):
        body (PatchApiDashboardsByDashboardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiDashboardsByDashboardIdResponse200 | PatchApiDashboardsByDashboardIdResponse400 | PatchApiDashboardsByDashboardIdResponse401 | PatchApiDashboardsByDashboardIdResponse403 | PatchApiDashboardsByDashboardIdResponse404 | PatchApiDashboardsByDashboardIdResponse500]
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
    body: PatchApiDashboardsByDashboardIdBody,
) -> (
    PatchApiDashboardsByDashboardIdResponse200
    | PatchApiDashboardsByDashboardIdResponse400
    | PatchApiDashboardsByDashboardIdResponse401
    | PatchApiDashboardsByDashboardIdResponse403
    | PatchApiDashboardsByDashboardIdResponse404
    | PatchApiDashboardsByDashboardIdResponse500
    | None
):
    """Update a dashboard

     Changes a dashboard's name, description or the trace origins its widgets leave out; a field the body
    leaves out keeps its value. A null description clears it; excludedOrigins [] includes Langy's
    traces, and null restores the default (Langy's left out, none in a personal project).

    Args:
        dashboard_id (str):
        body (PatchApiDashboardsByDashboardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiDashboardsByDashboardIdResponse200 | PatchApiDashboardsByDashboardIdResponse400 | PatchApiDashboardsByDashboardIdResponse401 | PatchApiDashboardsByDashboardIdResponse403 | PatchApiDashboardsByDashboardIdResponse404 | PatchApiDashboardsByDashboardIdResponse500
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
    body: PatchApiDashboardsByDashboardIdBody,
) -> Response[
    PatchApiDashboardsByDashboardIdResponse200
    | PatchApiDashboardsByDashboardIdResponse400
    | PatchApiDashboardsByDashboardIdResponse401
    | PatchApiDashboardsByDashboardIdResponse403
    | PatchApiDashboardsByDashboardIdResponse404
    | PatchApiDashboardsByDashboardIdResponse500
]:
    """Update a dashboard

     Changes a dashboard's name, description or the trace origins its widgets leave out; a field the body
    leaves out keeps its value. A null description clears it; excludedOrigins [] includes Langy's
    traces, and null restores the default (Langy's left out, none in a personal project).

    Args:
        dashboard_id (str):
        body (PatchApiDashboardsByDashboardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiDashboardsByDashboardIdResponse200 | PatchApiDashboardsByDashboardIdResponse400 | PatchApiDashboardsByDashboardIdResponse401 | PatchApiDashboardsByDashboardIdResponse403 | PatchApiDashboardsByDashboardIdResponse404 | PatchApiDashboardsByDashboardIdResponse500]
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
    body: PatchApiDashboardsByDashboardIdBody,
) -> (
    PatchApiDashboardsByDashboardIdResponse200
    | PatchApiDashboardsByDashboardIdResponse400
    | PatchApiDashboardsByDashboardIdResponse401
    | PatchApiDashboardsByDashboardIdResponse403
    | PatchApiDashboardsByDashboardIdResponse404
    | PatchApiDashboardsByDashboardIdResponse500
    | None
):
    """Update a dashboard

     Changes a dashboard's name, description or the trace origins its widgets leave out; a field the body
    leaves out keeps its value. A null description clears it; excludedOrigins [] includes Langy's
    traces, and null restores the default (Langy's left out, none in a personal project).

    Args:
        dashboard_id (str):
        body (PatchApiDashboardsByDashboardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiDashboardsByDashboardIdResponse200 | PatchApiDashboardsByDashboardIdResponse400 | PatchApiDashboardsByDashboardIdResponse401 | PatchApiDashboardsByDashboardIdResponse403 | PatchApiDashboardsByDashboardIdResponse404 | PatchApiDashboardsByDashboardIdResponse500
    """

    return (
        await asyncio_detailed(
            dashboard_id=dashboard_id,
            client=client,
            body=body,
        )
    ).parsed
