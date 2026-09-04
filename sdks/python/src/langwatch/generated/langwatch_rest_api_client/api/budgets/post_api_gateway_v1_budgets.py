from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_budgets_body import PostApiGatewayV1BudgetsBody
from ...models.post_api_gateway_v1_budgets_response_201 import PostApiGatewayV1BudgetsResponse201
from ...models.post_api_gateway_v1_budgets_response_400 import PostApiGatewayV1BudgetsResponse400
from ...models.post_api_gateway_v1_budgets_response_401 import PostApiGatewayV1BudgetsResponse401
from ...models.post_api_gateway_v1_budgets_response_403 import PostApiGatewayV1BudgetsResponse403
from ...models.post_api_gateway_v1_budgets_response_409 import PostApiGatewayV1BudgetsResponse409
from ...models.post_api_gateway_v1_budgets_response_500 import PostApiGatewayV1BudgetsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiGatewayV1BudgetsBody,
    idempotency_key: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/budgets",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1BudgetsResponse201
    | PostApiGatewayV1BudgetsResponse400
    | PostApiGatewayV1BudgetsResponse401
    | PostApiGatewayV1BudgetsResponse403
    | PostApiGatewayV1BudgetsResponse409
    | PostApiGatewayV1BudgetsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiGatewayV1BudgetsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiGatewayV1BudgetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1BudgetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1BudgetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = PostApiGatewayV1BudgetsResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = PostApiGatewayV1BudgetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1BudgetsResponse201
    | PostApiGatewayV1BudgetsResponse400
    | PostApiGatewayV1BudgetsResponse401
    | PostApiGatewayV1BudgetsResponse403
    | PostApiGatewayV1BudgetsResponse409
    | PostApiGatewayV1BudgetsResponse500
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
    body: PostApiGatewayV1BudgetsBody,
    idempotency_key: str | Unset = UNSET,
) -> Response[
    PostApiGatewayV1BudgetsResponse201
    | PostApiGatewayV1BudgetsResponse400
    | PostApiGatewayV1BudgetsResponse401
    | PostApiGatewayV1BudgetsResponse403
    | PostApiGatewayV1BudgetsResponse409
    | PostApiGatewayV1BudgetsResponse500
]:
    """Create budget

     Creates an organization-owned budget. The scope discriminates which resource the budget covers,
    across all seven scope types (organization / team / project / virtual_key / principal / group /
    attributed_user). `group` budgets are per-member allowances and `attributed_user` budgets are per-
    end-user templates; both require a deployment with the ClickHouse spend ledger
    (`group_budget_requires_clickhouse` otherwise). `provider_key` optionally pins the budget to one
    model provider. `cycle_anchor_at` optionally phases the window off a chosen instant instead of the
    calendar, for budgets that have to line up with a billing date. A `team`, `project` or `group`
    budget that none of the organization's active keys can produce traffic for is refused with
    `gateway_budget_scope_unreachable`, since it would never spend and never block; send
    `allow_unreachable` to keep it anyway, and note that an organization with no active keys is never
    refused. Send `Idempotency-Key` to make a retry safe.

    Args:
        idempotency_key (str | Unset):
        body (PostApiGatewayV1BudgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1BudgetsResponse201 | PostApiGatewayV1BudgetsResponse400 | PostApiGatewayV1BudgetsResponse401 | PostApiGatewayV1BudgetsResponse403 | PostApiGatewayV1BudgetsResponse409 | PostApiGatewayV1BudgetsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiGatewayV1BudgetsBody,
    idempotency_key: str | Unset = UNSET,
) -> (
    PostApiGatewayV1BudgetsResponse201
    | PostApiGatewayV1BudgetsResponse400
    | PostApiGatewayV1BudgetsResponse401
    | PostApiGatewayV1BudgetsResponse403
    | PostApiGatewayV1BudgetsResponse409
    | PostApiGatewayV1BudgetsResponse500
    | None
):
    """Create budget

     Creates an organization-owned budget. The scope discriminates which resource the budget covers,
    across all seven scope types (organization / team / project / virtual_key / principal / group /
    attributed_user). `group` budgets are per-member allowances and `attributed_user` budgets are per-
    end-user templates; both require a deployment with the ClickHouse spend ledger
    (`group_budget_requires_clickhouse` otherwise). `provider_key` optionally pins the budget to one
    model provider. `cycle_anchor_at` optionally phases the window off a chosen instant instead of the
    calendar, for budgets that have to line up with a billing date. A `team`, `project` or `group`
    budget that none of the organization's active keys can produce traffic for is refused with
    `gateway_budget_scope_unreachable`, since it would never spend and never block; send
    `allow_unreachable` to keep it anyway, and note that an organization with no active keys is never
    refused. Send `Idempotency-Key` to make a retry safe.

    Args:
        idempotency_key (str | Unset):
        body (PostApiGatewayV1BudgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1BudgetsResponse201 | PostApiGatewayV1BudgetsResponse400 | PostApiGatewayV1BudgetsResponse401 | PostApiGatewayV1BudgetsResponse403 | PostApiGatewayV1BudgetsResponse409 | PostApiGatewayV1BudgetsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiGatewayV1BudgetsBody,
    idempotency_key: str | Unset = UNSET,
) -> Response[
    PostApiGatewayV1BudgetsResponse201
    | PostApiGatewayV1BudgetsResponse400
    | PostApiGatewayV1BudgetsResponse401
    | PostApiGatewayV1BudgetsResponse403
    | PostApiGatewayV1BudgetsResponse409
    | PostApiGatewayV1BudgetsResponse500
]:
    """Create budget

     Creates an organization-owned budget. The scope discriminates which resource the budget covers,
    across all seven scope types (organization / team / project / virtual_key / principal / group /
    attributed_user). `group` budgets are per-member allowances and `attributed_user` budgets are per-
    end-user templates; both require a deployment with the ClickHouse spend ledger
    (`group_budget_requires_clickhouse` otherwise). `provider_key` optionally pins the budget to one
    model provider. `cycle_anchor_at` optionally phases the window off a chosen instant instead of the
    calendar, for budgets that have to line up with a billing date. A `team`, `project` or `group`
    budget that none of the organization's active keys can produce traffic for is refused with
    `gateway_budget_scope_unreachable`, since it would never spend and never block; send
    `allow_unreachable` to keep it anyway, and note that an organization with no active keys is never
    refused. Send `Idempotency-Key` to make a retry safe.

    Args:
        idempotency_key (str | Unset):
        body (PostApiGatewayV1BudgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1BudgetsResponse201 | PostApiGatewayV1BudgetsResponse400 | PostApiGatewayV1BudgetsResponse401 | PostApiGatewayV1BudgetsResponse403 | PostApiGatewayV1BudgetsResponse409 | PostApiGatewayV1BudgetsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiGatewayV1BudgetsBody,
    idempotency_key: str | Unset = UNSET,
) -> (
    PostApiGatewayV1BudgetsResponse201
    | PostApiGatewayV1BudgetsResponse400
    | PostApiGatewayV1BudgetsResponse401
    | PostApiGatewayV1BudgetsResponse403
    | PostApiGatewayV1BudgetsResponse409
    | PostApiGatewayV1BudgetsResponse500
    | None
):
    """Create budget

     Creates an organization-owned budget. The scope discriminates which resource the budget covers,
    across all seven scope types (organization / team / project / virtual_key / principal / group /
    attributed_user). `group` budgets are per-member allowances and `attributed_user` budgets are per-
    end-user templates; both require a deployment with the ClickHouse spend ledger
    (`group_budget_requires_clickhouse` otherwise). `provider_key` optionally pins the budget to one
    model provider. `cycle_anchor_at` optionally phases the window off a chosen instant instead of the
    calendar, for budgets that have to line up with a billing date. A `team`, `project` or `group`
    budget that none of the organization's active keys can produce traffic for is refused with
    `gateway_budget_scope_unreachable`, since it would never spend and never block; send
    `allow_unreachable` to keep it anyway, and note that an organization with no active keys is never
    refused. Send `Idempotency-Key` to make a retry safe.

    Args:
        idempotency_key (str | Unset):
        body (PostApiGatewayV1BudgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1BudgetsResponse201 | PostApiGatewayV1BudgetsResponse400 | PostApiGatewayV1BudgetsResponse401 | PostApiGatewayV1BudgetsResponse403 | PostApiGatewayV1BudgetsResponse409 | PostApiGatewayV1BudgetsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
