from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_gateway_v1_budgets_by_id_reset_body import PostApiGatewayV1BudgetsByIdResetBody
from ...models.post_api_gateway_v1_budgets_by_id_reset_response_200 import PostApiGatewayV1BudgetsByIdResetResponse200
from ...models.post_api_gateway_v1_budgets_by_id_reset_response_400 import PostApiGatewayV1BudgetsByIdResetResponse400
from ...models.post_api_gateway_v1_budgets_by_id_reset_response_401 import PostApiGatewayV1BudgetsByIdResetResponse401
from ...models.post_api_gateway_v1_budgets_by_id_reset_response_403 import PostApiGatewayV1BudgetsByIdResetResponse403
from ...models.post_api_gateway_v1_budgets_by_id_reset_response_500 import PostApiGatewayV1BudgetsByIdResetResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PostApiGatewayV1BudgetsByIdResetBody | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    params: dict[str, Any] = {}

    params["end_user_id"] = end_user_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/gateway/v1/budgets/{id}/reset".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGatewayV1BudgetsByIdResetResponse200
    | PostApiGatewayV1BudgetsByIdResetResponse400
    | PostApiGatewayV1BudgetsByIdResetResponse401
    | PostApiGatewayV1BudgetsByIdResetResponse403
    | PostApiGatewayV1BudgetsByIdResetResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGatewayV1BudgetsByIdResetResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGatewayV1BudgetsByIdResetResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGatewayV1BudgetsByIdResetResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGatewayV1BudgetsByIdResetResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiGatewayV1BudgetsByIdResetResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGatewayV1BudgetsByIdResetResponse200
    | PostApiGatewayV1BudgetsByIdResetResponse400
    | PostApiGatewayV1BudgetsByIdResetResponse401
    | PostApiGatewayV1BudgetsByIdResetResponse403
    | PostApiGatewayV1BudgetsByIdResetResponse500
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
    body: PostApiGatewayV1BudgetsByIdResetBody | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
) -> Response[
    PostApiGatewayV1BudgetsByIdResetResponse200
    | PostApiGatewayV1BudgetsByIdResetResponse400
    | PostApiGatewayV1BudgetsByIdResetResponse401
    | PostApiGatewayV1BudgetsByIdResetResponse403
    | PostApiGatewayV1BudgetsByIdResetResponse500
]:
    """Reset budget period

     Moves the budget's period boundary to now and recomputes the next reset; recorded spend is NEVER
    mutated (the ledger and every emitted billing event are immutable, so reconciliation is unaffected).
    On calendar windows this truncates the running period and the next boundary stays calendar; on
    `manual` windows the new period stays open until the next reset. For attributed-user templates,
    `end_user_id` resets ONE end-user bucket's boundary and leaves the template period untouched.

    Args:
        id (str):
        end_user_id (str | Unset): Resets ONE end-user bucket on an attributed-user template,
            leaving the template period untouched.
        body (PostApiGatewayV1BudgetsByIdResetBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1BudgetsByIdResetResponse200 | PostApiGatewayV1BudgetsByIdResetResponse400 | PostApiGatewayV1BudgetsByIdResetResponse401 | PostApiGatewayV1BudgetsByIdResetResponse403 | PostApiGatewayV1BudgetsByIdResetResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
        end_user_id=end_user_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1BudgetsByIdResetBody | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
) -> (
    PostApiGatewayV1BudgetsByIdResetResponse200
    | PostApiGatewayV1BudgetsByIdResetResponse400
    | PostApiGatewayV1BudgetsByIdResetResponse401
    | PostApiGatewayV1BudgetsByIdResetResponse403
    | PostApiGatewayV1BudgetsByIdResetResponse500
    | None
):
    """Reset budget period

     Moves the budget's period boundary to now and recomputes the next reset; recorded spend is NEVER
    mutated (the ledger and every emitted billing event are immutable, so reconciliation is unaffected).
    On calendar windows this truncates the running period and the next boundary stays calendar; on
    `manual` windows the new period stays open until the next reset. For attributed-user templates,
    `end_user_id` resets ONE end-user bucket's boundary and leaves the template period untouched.

    Args:
        id (str):
        end_user_id (str | Unset): Resets ONE end-user bucket on an attributed-user template,
            leaving the template period untouched.
        body (PostApiGatewayV1BudgetsByIdResetBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1BudgetsByIdResetResponse200 | PostApiGatewayV1BudgetsByIdResetResponse400 | PostApiGatewayV1BudgetsByIdResetResponse401 | PostApiGatewayV1BudgetsByIdResetResponse403 | PostApiGatewayV1BudgetsByIdResetResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
        end_user_id=end_user_id,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1BudgetsByIdResetBody | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
) -> Response[
    PostApiGatewayV1BudgetsByIdResetResponse200
    | PostApiGatewayV1BudgetsByIdResetResponse400
    | PostApiGatewayV1BudgetsByIdResetResponse401
    | PostApiGatewayV1BudgetsByIdResetResponse403
    | PostApiGatewayV1BudgetsByIdResetResponse500
]:
    """Reset budget period

     Moves the budget's period boundary to now and recomputes the next reset; recorded spend is NEVER
    mutated (the ledger and every emitted billing event are immutable, so reconciliation is unaffected).
    On calendar windows this truncates the running period and the next boundary stays calendar; on
    `manual` windows the new period stays open until the next reset. For attributed-user templates,
    `end_user_id` resets ONE end-user bucket's boundary and leaves the template period untouched.

    Args:
        id (str):
        end_user_id (str | Unset): Resets ONE end-user bucket on an attributed-user template,
            leaving the template period untouched.
        body (PostApiGatewayV1BudgetsByIdResetBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGatewayV1BudgetsByIdResetResponse200 | PostApiGatewayV1BudgetsByIdResetResponse400 | PostApiGatewayV1BudgetsByIdResetResponse401 | PostApiGatewayV1BudgetsByIdResetResponse403 | PostApiGatewayV1BudgetsByIdResetResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
        end_user_id=end_user_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiGatewayV1BudgetsByIdResetBody | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
) -> (
    PostApiGatewayV1BudgetsByIdResetResponse200
    | PostApiGatewayV1BudgetsByIdResetResponse400
    | PostApiGatewayV1BudgetsByIdResetResponse401
    | PostApiGatewayV1BudgetsByIdResetResponse403
    | PostApiGatewayV1BudgetsByIdResetResponse500
    | None
):
    """Reset budget period

     Moves the budget's period boundary to now and recomputes the next reset; recorded spend is NEVER
    mutated (the ledger and every emitted billing event are immutable, so reconciliation is unaffected).
    On calendar windows this truncates the running period and the next boundary stays calendar; on
    `manual` windows the new period stays open until the next reset. For attributed-user templates,
    `end_user_id` resets ONE end-user bucket's boundary and leaves the template period untouched.

    Args:
        id (str):
        end_user_id (str | Unset): Resets ONE end-user bucket on an attributed-user template,
            leaving the template period untouched.
        body (PostApiGatewayV1BudgetsByIdResetBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGatewayV1BudgetsByIdResetResponse200 | PostApiGatewayV1BudgetsByIdResetResponse400 | PostApiGatewayV1BudgetsByIdResetResponse401 | PostApiGatewayV1BudgetsByIdResetResponse403 | PostApiGatewayV1BudgetsByIdResetResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
            end_user_id=end_user_id,
        )
    ).parsed
