from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_projects_by_project_id_analytics_schema_response_200 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200,
)
from ...models.get_api_v1_projects_by_project_id_analytics_schema_response_400 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400,
)
from ...models.get_api_v1_projects_by_project_id_analytics_schema_response_401 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401,
)
from ...models.get_api_v1_projects_by_project_id_analytics_schema_response_403 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403,
)
from ...models.get_api_v1_projects_by_project_id_analytics_schema_response_500 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/projects/{project_id}/analytics/schema".format(
            project_id=quote(str(project_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
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
) -> Response[
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
]:
    """Discover the LangWatchQL analytics schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Args:
        project_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
    | None
):
    """Discover the LangWatchQL analytics schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Args:
        project_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
    """

    return sync_detailed(
        project_id=project_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
]:
    """Discover the LangWatchQL analytics schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Args:
        project_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403
    | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
    | None
):
    """Discover the LangWatchQL analytics schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Args:
        project_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse400 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse401 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse403 | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            client=client,
        )
    ).parsed
