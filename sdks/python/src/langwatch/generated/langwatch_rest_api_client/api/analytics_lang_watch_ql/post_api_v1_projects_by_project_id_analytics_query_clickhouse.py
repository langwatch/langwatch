from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_body import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody,
)
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200 import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200,
)
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_400 import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400,
)
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_401 import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401,
)
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_403 import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403,
)
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_422 import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422,
)
from ...models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_500 import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    *,
    body: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/projects/{project_id}/analytics/query/clickhouse".format(
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
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
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
    body: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody,
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
]:
    """Run LangWatchQL analytics SQL

     Executes one read-only ClickHouse SELECT over the LangWatchQL analytics datasets and returns typed
    columns, rows, execution statistics, truncation state and diagnostics. The query runs as a
    restricted database identity scoped to the authenticated project. Diagnostics are advisory and never
    reject a query. An empty diagnostics list means no known issue was detected. It is not proof that
    the answer is the one you meant.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500]
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
    body: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody,
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
    | None
):
    """Run LangWatchQL analytics SQL

     Executes one read-only ClickHouse SELECT over the LangWatchQL analytics datasets and returns typed
    columns, rows, execution statistics, truncation state and diagnostics. The query runs as a
    restricted database identity scoped to the authenticated project. Diagnostics are advisory and never
    reject a query. An empty diagnostics list means no known issue was detected. It is not proof that
    the answer is the one you meant.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
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
    body: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody,
) -> Response[
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
]:
    """Run LangWatchQL analytics SQL

     Executes one read-only ClickHouse SELECT over the LangWatchQL analytics datasets and returns typed
    columns, rows, execution statistics, truncation state and diagnostics. The query runs as a
    restricted database identity scoped to the authenticated project. Diagnostics are advisory and never
    reject a query. An empty diagnostics list means no known issue was detected. It is not proof that
    the answer is the one you meant.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500]
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
    body: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody,
) -> (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422
    | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
    | None
):
    """Run LangWatchQL analytics SQL

     Executes one read-only ClickHouse SELECT over the LangWatchQL analytics datasets and returns typed
    columns, rows, execution statistics, truncation state and diagnostics. The query runs as a
    restricted database identity scoped to the authenticated project. Diagnostics are advisory and never
    reject a query. An empty diagnostics list means no known issue was detected. It is not proof that
    the answer is the one you meant.

    Args:
        project_id (str):
        body (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse400 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse401 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse403 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse422 | PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            client=client,
            body=body,
        )
    ).parsed
