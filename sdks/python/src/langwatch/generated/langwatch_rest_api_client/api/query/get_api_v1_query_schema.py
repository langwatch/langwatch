from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_query_schema_response_200 import GetApiV1QuerySchemaResponse200
from ...models.get_api_v1_query_schema_response_400 import GetApiV1QuerySchemaResponse400
from ...models.get_api_v1_query_schema_response_401 import GetApiV1QuerySchemaResponse401
from ...models.get_api_v1_query_schema_response_403 import GetApiV1QuerySchemaResponse403
from ...models.get_api_v1_query_schema_response_500 import GetApiV1QuerySchemaResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/query/schema",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiV1QuerySchemaResponse200
    | GetApiV1QuerySchemaResponse400
    | GetApiV1QuerySchemaResponse401
    | GetApiV1QuerySchemaResponse403
    | GetApiV1QuerySchemaResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiV1QuerySchemaResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiV1QuerySchemaResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiV1QuerySchemaResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiV1QuerySchemaResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiV1QuerySchemaResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiV1QuerySchemaResponse200
    | GetApiV1QuerySchemaResponse400
    | GetApiV1QuerySchemaResponse401
    | GetApiV1QuerySchemaResponse403
    | GetApiV1QuerySchemaResponse500
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
) -> Response[
    GetApiV1QuerySchemaResponse200
    | GetApiV1QuerySchemaResponse400
    | GetApiV1QuerySchemaResponse401
    | GetApiV1QuerySchemaResponse403
    | GetApiV1QuerySchemaResponse500
]:
    """Discover the queryable LangWatchQL schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Scoped to the credential's own project and its permissions: a column this key cannot read is listed
    with `available: false` rather than hidden, so a caller can see what a wider key would unlock.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1QuerySchemaResponse200 | GetApiV1QuerySchemaResponse400 | GetApiV1QuerySchemaResponse401 | GetApiV1QuerySchemaResponse403 | GetApiV1QuerySchemaResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1QuerySchemaResponse200
    | GetApiV1QuerySchemaResponse400
    | GetApiV1QuerySchemaResponse401
    | GetApiV1QuerySchemaResponse403
    | GetApiV1QuerySchemaResponse500
    | None
):
    """Discover the queryable LangWatchQL schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Scoped to the credential's own project and its permissions: a column this key cannot read is listed
    with `available: false` rather than hidden, so a caller can see what a wider key would unlock.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1QuerySchemaResponse200 | GetApiV1QuerySchemaResponse400 | GetApiV1QuerySchemaResponse401 | GetApiV1QuerySchemaResponse403 | GetApiV1QuerySchemaResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiV1QuerySchemaResponse200
    | GetApiV1QuerySchemaResponse400
    | GetApiV1QuerySchemaResponse401
    | GetApiV1QuerySchemaResponse403
    | GetApiV1QuerySchemaResponse500
]:
    """Discover the queryable LangWatchQL schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Scoped to the credential's own project and its permissions: a column this key cannot read is listed
    with `available: false` rather than hidden, so a caller can see what a wider key would unlock.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1QuerySchemaResponse200 | GetApiV1QuerySchemaResponse400 | GetApiV1QuerySchemaResponse401 | GetApiV1QuerySchemaResponse403 | GetApiV1QuerySchemaResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1QuerySchemaResponse200
    | GetApiV1QuerySchemaResponse400
    | GetApiV1QuerySchemaResponse401
    | GetApiV1QuerySchemaResponse403
    | GetApiV1QuerySchemaResponse500
    | None
):
    """Discover the queryable LangWatchQL schema

     Lists the LangWatchQL analytics datasets this key may query, with each column's type, description,
    the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join
    keys, partition-pruning time column, freshness and a runnable example query.

    Scoped to the credential's own project and its permissions: a column this key cannot read is listed
    with `available: false` rather than hidden, so a caller can see what a wider key would unlock.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1QuerySchemaResponse200 | GetApiV1QuerySchemaResponse400 | GetApiV1QuerySchemaResponse401 | GetApiV1QuerySchemaResponse403 | GetApiV1QuerySchemaResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
