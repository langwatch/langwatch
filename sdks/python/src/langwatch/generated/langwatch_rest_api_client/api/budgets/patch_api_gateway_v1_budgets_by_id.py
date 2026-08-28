from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_gateway_v1_budgets_by_id_body import PatchApiGatewayV1BudgetsByIdBody
from ...models.patch_api_gateway_v1_budgets_by_id_response_200 import PatchApiGatewayV1BudgetsByIdResponse200
from ...models.patch_api_gateway_v1_budgets_by_id_response_400 import PatchApiGatewayV1BudgetsByIdResponse400
from ...models.patch_api_gateway_v1_budgets_by_id_response_401 import PatchApiGatewayV1BudgetsByIdResponse401
from ...models.patch_api_gateway_v1_budgets_by_id_response_403 import PatchApiGatewayV1BudgetsByIdResponse403
from ...models.patch_api_gateway_v1_budgets_by_id_response_500 import PatchApiGatewayV1BudgetsByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PatchApiGatewayV1BudgetsByIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/gateway/v1/budgets/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiGatewayV1BudgetsByIdResponse200
    | PatchApiGatewayV1BudgetsByIdResponse400
    | PatchApiGatewayV1BudgetsByIdResponse401
    | PatchApiGatewayV1BudgetsByIdResponse403
    | PatchApiGatewayV1BudgetsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiGatewayV1BudgetsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiGatewayV1BudgetsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiGatewayV1BudgetsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiGatewayV1BudgetsByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PatchApiGatewayV1BudgetsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiGatewayV1BudgetsByIdResponse200
    | PatchApiGatewayV1BudgetsByIdResponse400
    | PatchApiGatewayV1BudgetsByIdResponse401
    | PatchApiGatewayV1BudgetsByIdResponse403
    | PatchApiGatewayV1BudgetsByIdResponse500
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
    client: AuthenticatedClient,
    body: PatchApiGatewayV1BudgetsByIdBody,
) -> Response[
    PatchApiGatewayV1BudgetsByIdResponse200
    | PatchApiGatewayV1BudgetsByIdResponse400
    | PatchApiGatewayV1BudgetsByIdResponse401
    | PatchApiGatewayV1BudgetsByIdResponse403
    | PatchApiGatewayV1BudgetsByIdResponse500
]:
    """Update budget

     Partial update. Scope, window and cycle_anchor_at are immutable after create. Use explicit null to
    clear timezone / description.

    Args:
        id (str):
        body (PatchApiGatewayV1BudgetsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGatewayV1BudgetsByIdResponse200 | PatchApiGatewayV1BudgetsByIdResponse400 | PatchApiGatewayV1BudgetsByIdResponse401 | PatchApiGatewayV1BudgetsByIdResponse403 | PatchApiGatewayV1BudgetsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGatewayV1BudgetsByIdBody,
) -> (
    PatchApiGatewayV1BudgetsByIdResponse200
    | PatchApiGatewayV1BudgetsByIdResponse400
    | PatchApiGatewayV1BudgetsByIdResponse401
    | PatchApiGatewayV1BudgetsByIdResponse403
    | PatchApiGatewayV1BudgetsByIdResponse500
    | None
):
    """Update budget

     Partial update. Scope, window and cycle_anchor_at are immutable after create. Use explicit null to
    clear timezone / description.

    Args:
        id (str):
        body (PatchApiGatewayV1BudgetsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGatewayV1BudgetsByIdResponse200 | PatchApiGatewayV1BudgetsByIdResponse400 | PatchApiGatewayV1BudgetsByIdResponse401 | PatchApiGatewayV1BudgetsByIdResponse403 | PatchApiGatewayV1BudgetsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGatewayV1BudgetsByIdBody,
) -> Response[
    PatchApiGatewayV1BudgetsByIdResponse200
    | PatchApiGatewayV1BudgetsByIdResponse400
    | PatchApiGatewayV1BudgetsByIdResponse401
    | PatchApiGatewayV1BudgetsByIdResponse403
    | PatchApiGatewayV1BudgetsByIdResponse500
]:
    """Update budget

     Partial update. Scope, window and cycle_anchor_at are immutable after create. Use explicit null to
    clear timezone / description.

    Args:
        id (str):
        body (PatchApiGatewayV1BudgetsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGatewayV1BudgetsByIdResponse200 | PatchApiGatewayV1BudgetsByIdResponse400 | PatchApiGatewayV1BudgetsByIdResponse401 | PatchApiGatewayV1BudgetsByIdResponse403 | PatchApiGatewayV1BudgetsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGatewayV1BudgetsByIdBody,
) -> (
    PatchApiGatewayV1BudgetsByIdResponse200
    | PatchApiGatewayV1BudgetsByIdResponse400
    | PatchApiGatewayV1BudgetsByIdResponse401
    | PatchApiGatewayV1BudgetsByIdResponse403
    | PatchApiGatewayV1BudgetsByIdResponse500
    | None
):
    """Update budget

     Partial update. Scope, window and cycle_anchor_at are immutable after create. Use explicit null to
    clear timezone / description.

    Args:
        id (str):
        body (PatchApiGatewayV1BudgetsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGatewayV1BudgetsByIdResponse200 | PatchApiGatewayV1BudgetsByIdResponse400 | PatchApiGatewayV1BudgetsByIdResponse401 | PatchApiGatewayV1BudgetsByIdResponse403 | PatchApiGatewayV1BudgetsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
