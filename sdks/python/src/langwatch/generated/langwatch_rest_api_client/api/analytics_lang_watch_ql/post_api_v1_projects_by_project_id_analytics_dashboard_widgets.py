from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody,
)
from ...models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_201 import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201,
)
from ...models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_400 import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400,
)
from ...models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_401 import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401,
)
from ...models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_403 import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403,
)
from ...models.post_api_v1_projects_by_project_id_analytics_dashboard_widgets_response_500 import (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    *,
    body: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/projects/{project_id}/analytics/dashboard-widgets".format(
            project_id=quote(str(project_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
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
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody,
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
]:
    """Create a dashboard widget

     Saves a React source file and the named LangWatchQL queries it runs as one dashboard widget. The
    queries' shape is validated against the widget schema; their SQL is governed at run time by LW.query
    inside the sandbox, not at save.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody,
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
    | None
):
    """Create a dashboard widget

     Saves a React source file and the named LangWatchQL queries it runs as one dashboard widget. The
    queries' shape is validated against the widget schema; their SQL is governed at run time by LW.query
    inside the sandbox, not at save.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
    """

    return sync_detailed(
        project_id=project_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody,
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
]:
    """Create a dashboard widget

     Saves a React source file and the named LangWatchQL queries it runs as one dashboard widget. The
    queries' shape is validated against the widget schema; their SQL is governed at run time by LW.query
    inside the sandbox, not at save.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody,
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
    | None
):
    """Create a dashboard widget

     Saves a React source file and the named LangWatchQL queries it runs as one dashboard widget. The
    queries' shape is validated against the widget schema; their SQL is governed at run time by LW.query
    inside the sandbox, not at save.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse201 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse400 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse401 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse403 | PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            client=client,
            body=body,
        )
    ).parsed
