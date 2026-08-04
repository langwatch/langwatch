from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_gateway_v1_cache_rules_by_id_response_200 import DeleteApiGatewayV1CacheRulesByIdResponse200
from ...models.delete_api_gateway_v1_cache_rules_by_id_response_400 import DeleteApiGatewayV1CacheRulesByIdResponse400
from ...models.delete_api_gateway_v1_cache_rules_by_id_response_401 import DeleteApiGatewayV1CacheRulesByIdResponse401
from ...models.delete_api_gateway_v1_cache_rules_by_id_response_403 import DeleteApiGatewayV1CacheRulesByIdResponse403
from ...models.delete_api_gateway_v1_cache_rules_by_id_response_500 import DeleteApiGatewayV1CacheRulesByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/gateway/v1/cache-rules/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiGatewayV1CacheRulesByIdResponse200
    | DeleteApiGatewayV1CacheRulesByIdResponse400
    | DeleteApiGatewayV1CacheRulesByIdResponse401
    | DeleteApiGatewayV1CacheRulesByIdResponse403
    | DeleteApiGatewayV1CacheRulesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiGatewayV1CacheRulesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiGatewayV1CacheRulesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiGatewayV1CacheRulesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiGatewayV1CacheRulesByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = DeleteApiGatewayV1CacheRulesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiGatewayV1CacheRulesByIdResponse200
    | DeleteApiGatewayV1CacheRulesByIdResponse400
    | DeleteApiGatewayV1CacheRulesByIdResponse401
    | DeleteApiGatewayV1CacheRulesByIdResponse403
    | DeleteApiGatewayV1CacheRulesByIdResponse500
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
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    DeleteApiGatewayV1CacheRulesByIdResponse200
    | DeleteApiGatewayV1CacheRulesByIdResponse400
    | DeleteApiGatewayV1CacheRulesByIdResponse401
    | DeleteApiGatewayV1CacheRulesByIdResponse403
    | DeleteApiGatewayV1CacheRulesByIdResponse500
]:
    """Archive a cache rule

     Soft-delete: sets archivedAt. The rule stops matching new requests. Audit log retains before/after
    snapshots. Returns the archived row.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGatewayV1CacheRulesByIdResponse200 | DeleteApiGatewayV1CacheRulesByIdResponse400 | DeleteApiGatewayV1CacheRulesByIdResponse401 | DeleteApiGatewayV1CacheRulesByIdResponse403 | DeleteApiGatewayV1CacheRulesByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    DeleteApiGatewayV1CacheRulesByIdResponse200
    | DeleteApiGatewayV1CacheRulesByIdResponse400
    | DeleteApiGatewayV1CacheRulesByIdResponse401
    | DeleteApiGatewayV1CacheRulesByIdResponse403
    | DeleteApiGatewayV1CacheRulesByIdResponse500
    | None
):
    """Archive a cache rule

     Soft-delete: sets archivedAt. The rule stops matching new requests. Audit log retains before/after
    snapshots. Returns the archived row.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGatewayV1CacheRulesByIdResponse200 | DeleteApiGatewayV1CacheRulesByIdResponse400 | DeleteApiGatewayV1CacheRulesByIdResponse401 | DeleteApiGatewayV1CacheRulesByIdResponse403 | DeleteApiGatewayV1CacheRulesByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    DeleteApiGatewayV1CacheRulesByIdResponse200
    | DeleteApiGatewayV1CacheRulesByIdResponse400
    | DeleteApiGatewayV1CacheRulesByIdResponse401
    | DeleteApiGatewayV1CacheRulesByIdResponse403
    | DeleteApiGatewayV1CacheRulesByIdResponse500
]:
    """Archive a cache rule

     Soft-delete: sets archivedAt. The rule stops matching new requests. Audit log retains before/after
    snapshots. Returns the archived row.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGatewayV1CacheRulesByIdResponse200 | DeleteApiGatewayV1CacheRulesByIdResponse400 | DeleteApiGatewayV1CacheRulesByIdResponse401 | DeleteApiGatewayV1CacheRulesByIdResponse403 | DeleteApiGatewayV1CacheRulesByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    DeleteApiGatewayV1CacheRulesByIdResponse200
    | DeleteApiGatewayV1CacheRulesByIdResponse400
    | DeleteApiGatewayV1CacheRulesByIdResponse401
    | DeleteApiGatewayV1CacheRulesByIdResponse403
    | DeleteApiGatewayV1CacheRulesByIdResponse500
    | None
):
    """Archive a cache rule

     Soft-delete: sets archivedAt. The rule stops matching new requests. Audit log retains before/after
    snapshots. Returns the archived row.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGatewayV1CacheRulesByIdResponse200 | DeleteApiGatewayV1CacheRulesByIdResponse400 | DeleteApiGatewayV1CacheRulesByIdResponse401 | DeleteApiGatewayV1CacheRulesByIdResponse403 | DeleteApiGatewayV1CacheRulesByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
