from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dashboards_body import PostApiDashboardsBody
from ...models.post_api_dashboards_response_201 import PostApiDashboardsResponse201
from ...models.post_api_dashboards_response_400 import PostApiDashboardsResponse400
from ...models.post_api_dashboards_response_401 import PostApiDashboardsResponse401
from ...models.post_api_dashboards_response_403 import PostApiDashboardsResponse403
from ...models.post_api_dashboards_response_500 import PostApiDashboardsResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiDashboardsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dashboards",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiDashboardsResponse201
    | PostApiDashboardsResponse400
    | PostApiDashboardsResponse401
    | PostApiDashboardsResponse403
    | PostApiDashboardsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiDashboardsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiDashboardsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiDashboardsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiDashboardsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiDashboardsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiDashboardsResponse201
    | PostApiDashboardsResponse400
    | PostApiDashboardsResponse401
    | PostApiDashboardsResponse403
    | PostApiDashboardsResponse500
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
    body: PostApiDashboardsBody,
) -> Response[
    PostApiDashboardsResponse201
    | PostApiDashboardsResponse400
    | PostApiDashboardsResponse401
    | PostApiDashboardsResponse403
    | PostApiDashboardsResponse500
]:
    """Create a board

     Creates an empty Dashboards board in the key's project. Add widgets to it with POST
    /api/v1/dashboards/{dashboardId}/widgets.

    Args:
        body (PostApiDashboardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDashboardsResponse201 | PostApiDashboardsResponse400 | PostApiDashboardsResponse401 | PostApiDashboardsResponse403 | PostApiDashboardsResponse500]
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
    body: PostApiDashboardsBody,
) -> (
    PostApiDashboardsResponse201
    | PostApiDashboardsResponse400
    | PostApiDashboardsResponse401
    | PostApiDashboardsResponse403
    | PostApiDashboardsResponse500
    | None
):
    """Create a board

     Creates an empty Dashboards board in the key's project. Add widgets to it with POST
    /api/v1/dashboards/{dashboardId}/widgets.

    Args:
        body (PostApiDashboardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDashboardsResponse201 | PostApiDashboardsResponse400 | PostApiDashboardsResponse401 | PostApiDashboardsResponse403 | PostApiDashboardsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiDashboardsBody,
) -> Response[
    PostApiDashboardsResponse201
    | PostApiDashboardsResponse400
    | PostApiDashboardsResponse401
    | PostApiDashboardsResponse403
    | PostApiDashboardsResponse500
]:
    """Create a board

     Creates an empty Dashboards board in the key's project. Add widgets to it with POST
    /api/v1/dashboards/{dashboardId}/widgets.

    Args:
        body (PostApiDashboardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDashboardsResponse201 | PostApiDashboardsResponse400 | PostApiDashboardsResponse401 | PostApiDashboardsResponse403 | PostApiDashboardsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiDashboardsBody,
) -> (
    PostApiDashboardsResponse201
    | PostApiDashboardsResponse400
    | PostApiDashboardsResponse401
    | PostApiDashboardsResponse403
    | PostApiDashboardsResponse500
    | None
):
    """Create a board

     Creates an empty Dashboards board in the key's project. Add widgets to it with POST
    /api/v1/dashboards/{dashboardId}/widgets.

    Args:
        body (PostApiDashboardsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDashboardsResponse201 | PostApiDashboardsResponse400 | PostApiDashboardsResponse401 | PostApiDashboardsResponse403 | PostApiDashboardsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
