from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_cache_rules_by_id_response_200 import GetApiGatewayV1CacheRulesByIdResponse200
from ...models.get_api_gateway_v1_cache_rules_by_id_response_400 import GetApiGatewayV1CacheRulesByIdResponse400
from ...models.get_api_gateway_v1_cache_rules_by_id_response_401 import GetApiGatewayV1CacheRulesByIdResponse401
from ...models.get_api_gateway_v1_cache_rules_by_id_response_403 import GetApiGatewayV1CacheRulesByIdResponse403
from ...models.get_api_gateway_v1_cache_rules_by_id_response_500 import GetApiGatewayV1CacheRulesByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/cache-rules/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1CacheRulesByIdResponse200
    | GetApiGatewayV1CacheRulesByIdResponse400
    | GetApiGatewayV1CacheRulesByIdResponse401
    | GetApiGatewayV1CacheRulesByIdResponse403
    | GetApiGatewayV1CacheRulesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1CacheRulesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1CacheRulesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1CacheRulesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1CacheRulesByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1CacheRulesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1CacheRulesByIdResponse200
    | GetApiGatewayV1CacheRulesByIdResponse400
    | GetApiGatewayV1CacheRulesByIdResponse401
    | GetApiGatewayV1CacheRulesByIdResponse403
    | GetApiGatewayV1CacheRulesByIdResponse500
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
    GetApiGatewayV1CacheRulesByIdResponse200
    | GetApiGatewayV1CacheRulesByIdResponse400
    | GetApiGatewayV1CacheRulesByIdResponse401
    | GetApiGatewayV1CacheRulesByIdResponse403
    | GetApiGatewayV1CacheRulesByIdResponse500
]:
    """Get a cache rule

     Returns the rule if it belongs to the caller's organisation; 404 otherwise. Archived rules are NOT
    returned (use the audit log to inspect removed rules).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1CacheRulesByIdResponse200 | GetApiGatewayV1CacheRulesByIdResponse400 | GetApiGatewayV1CacheRulesByIdResponse401 | GetApiGatewayV1CacheRulesByIdResponse403 | GetApiGatewayV1CacheRulesByIdResponse500]
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
    GetApiGatewayV1CacheRulesByIdResponse200
    | GetApiGatewayV1CacheRulesByIdResponse400
    | GetApiGatewayV1CacheRulesByIdResponse401
    | GetApiGatewayV1CacheRulesByIdResponse403
    | GetApiGatewayV1CacheRulesByIdResponse500
    | None
):
    """Get a cache rule

     Returns the rule if it belongs to the caller's organisation; 404 otherwise. Archived rules are NOT
    returned (use the audit log to inspect removed rules).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1CacheRulesByIdResponse200 | GetApiGatewayV1CacheRulesByIdResponse400 | GetApiGatewayV1CacheRulesByIdResponse401 | GetApiGatewayV1CacheRulesByIdResponse403 | GetApiGatewayV1CacheRulesByIdResponse500
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
    GetApiGatewayV1CacheRulesByIdResponse200
    | GetApiGatewayV1CacheRulesByIdResponse400
    | GetApiGatewayV1CacheRulesByIdResponse401
    | GetApiGatewayV1CacheRulesByIdResponse403
    | GetApiGatewayV1CacheRulesByIdResponse500
]:
    """Get a cache rule

     Returns the rule if it belongs to the caller's organisation; 404 otherwise. Archived rules are NOT
    returned (use the audit log to inspect removed rules).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1CacheRulesByIdResponse200 | GetApiGatewayV1CacheRulesByIdResponse400 | GetApiGatewayV1CacheRulesByIdResponse401 | GetApiGatewayV1CacheRulesByIdResponse403 | GetApiGatewayV1CacheRulesByIdResponse500]
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
    GetApiGatewayV1CacheRulesByIdResponse200
    | GetApiGatewayV1CacheRulesByIdResponse400
    | GetApiGatewayV1CacheRulesByIdResponse401
    | GetApiGatewayV1CacheRulesByIdResponse403
    | GetApiGatewayV1CacheRulesByIdResponse500
    | None
):
    """Get a cache rule

     Returns the rule if it belongs to the caller's organisation; 404 otherwise. Archived rules are NOT
    returned (use the audit log to inspect removed rules).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1CacheRulesByIdResponse200 | GetApiGatewayV1CacheRulesByIdResponse400 | GetApiGatewayV1CacheRulesByIdResponse401 | GetApiGatewayV1CacheRulesByIdResponse403 | GetApiGatewayV1CacheRulesByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
