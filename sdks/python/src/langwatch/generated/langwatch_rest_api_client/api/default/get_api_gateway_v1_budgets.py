from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_budgets_response_200 import GetApiGatewayV1BudgetsResponse200
from ...models.get_api_gateway_v1_budgets_response_400 import GetApiGatewayV1BudgetsResponse400
from ...models.get_api_gateway_v1_budgets_response_401 import GetApiGatewayV1BudgetsResponse401
from ...models.get_api_gateway_v1_budgets_response_403 import GetApiGatewayV1BudgetsResponse403
from ...models.get_api_gateway_v1_budgets_response_500 import GetApiGatewayV1BudgetsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    scope_type: str | Unset = UNSET,
    external_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["cursor"] = cursor

    params["limit"] = limit

    params["scope_type"] = scope_type

    params["external_id"] = external_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/budgets",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1BudgetsResponse200
    | GetApiGatewayV1BudgetsResponse400
    | GetApiGatewayV1BudgetsResponse401
    | GetApiGatewayV1BudgetsResponse403
    | GetApiGatewayV1BudgetsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1BudgetsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1BudgetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1BudgetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1BudgetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1BudgetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1BudgetsResponse200
    | GetApiGatewayV1BudgetsResponse400
    | GetApiGatewayV1BudgetsResponse401
    | GetApiGatewayV1BudgetsResponse403
    | GetApiGatewayV1BudgetsResponse500
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
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    scope_type: str | Unset = UNSET,
    external_id: str | Unset = UNSET,
) -> Response[
    GetApiGatewayV1BudgetsResponse200
    | GetApiGatewayV1BudgetsResponse400
    | GetApiGatewayV1BudgetsResponse401
    | GetApiGatewayV1BudgetsResponse403
    | GetApiGatewayV1BudgetsResponse500
]:
    """List budgets

     Returns the non-archived budgets in the caller's organization across all seven scope types, with
    live spent_usd from the spend ledger.

    Args:
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        scope_type (str | Unset):
        external_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1BudgetsResponse200 | GetApiGatewayV1BudgetsResponse400 | GetApiGatewayV1BudgetsResponse401 | GetApiGatewayV1BudgetsResponse403 | GetApiGatewayV1BudgetsResponse500]
    """

    kwargs = _get_kwargs(
        cursor=cursor,
        limit=limit,
        scope_type=scope_type,
        external_id=external_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    scope_type: str | Unset = UNSET,
    external_id: str | Unset = UNSET,
) -> (
    GetApiGatewayV1BudgetsResponse200
    | GetApiGatewayV1BudgetsResponse400
    | GetApiGatewayV1BudgetsResponse401
    | GetApiGatewayV1BudgetsResponse403
    | GetApiGatewayV1BudgetsResponse500
    | None
):
    """List budgets

     Returns the non-archived budgets in the caller's organization across all seven scope types, with
    live spent_usd from the spend ledger.

    Args:
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        scope_type (str | Unset):
        external_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1BudgetsResponse200 | GetApiGatewayV1BudgetsResponse400 | GetApiGatewayV1BudgetsResponse401 | GetApiGatewayV1BudgetsResponse403 | GetApiGatewayV1BudgetsResponse500
    """

    return sync_detailed(
        client=client,
        cursor=cursor,
        limit=limit,
        scope_type=scope_type,
        external_id=external_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    scope_type: str | Unset = UNSET,
    external_id: str | Unset = UNSET,
) -> Response[
    GetApiGatewayV1BudgetsResponse200
    | GetApiGatewayV1BudgetsResponse400
    | GetApiGatewayV1BudgetsResponse401
    | GetApiGatewayV1BudgetsResponse403
    | GetApiGatewayV1BudgetsResponse500
]:
    """List budgets

     Returns the non-archived budgets in the caller's organization across all seven scope types, with
    live spent_usd from the spend ledger.

    Args:
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        scope_type (str | Unset):
        external_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1BudgetsResponse200 | GetApiGatewayV1BudgetsResponse400 | GetApiGatewayV1BudgetsResponse401 | GetApiGatewayV1BudgetsResponse403 | GetApiGatewayV1BudgetsResponse500]
    """

    kwargs = _get_kwargs(
        cursor=cursor,
        limit=limit,
        scope_type=scope_type,
        external_id=external_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    scope_type: str | Unset = UNSET,
    external_id: str | Unset = UNSET,
) -> (
    GetApiGatewayV1BudgetsResponse200
    | GetApiGatewayV1BudgetsResponse400
    | GetApiGatewayV1BudgetsResponse401
    | GetApiGatewayV1BudgetsResponse403
    | GetApiGatewayV1BudgetsResponse500
    | None
):
    """List budgets

     Returns the non-archived budgets in the caller's organization across all seven scope types, with
    live spent_usd from the spend ledger.

    Args:
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        scope_type (str | Unset):
        external_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1BudgetsResponse200 | GetApiGatewayV1BudgetsResponse400 | GetApiGatewayV1BudgetsResponse401 | GetApiGatewayV1BudgetsResponse403 | GetApiGatewayV1BudgetsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            cursor=cursor,
            limit=limit,
            scope_type=scope_type,
            external_id=external_id,
        )
    ).parsed
