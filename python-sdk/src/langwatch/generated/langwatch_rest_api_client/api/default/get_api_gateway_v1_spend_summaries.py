from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_spend_summaries_group_by import GetApiGatewayV1SpendSummariesGroupBy
from ...models.get_api_gateway_v1_spend_summaries_response_200 import GetApiGatewayV1SpendSummariesResponse200
from ...models.get_api_gateway_v1_spend_summaries_response_400 import GetApiGatewayV1SpendSummariesResponse400
from ...models.get_api_gateway_v1_spend_summaries_response_401 import GetApiGatewayV1SpendSummariesResponse401
from ...models.get_api_gateway_v1_spend_summaries_response_403 import GetApiGatewayV1SpendSummariesResponse403
from ...models.get_api_gateway_v1_spend_summaries_response_500 import GetApiGatewayV1SpendSummariesResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    group_by: GetApiGatewayV1SpendSummariesGroupBy,
    from_: int,
    to: int,
    project_id: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
    virtual_key_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_group_by = group_by.value
    params["group_by"] = json_group_by

    params["from"] = from_

    params["to"] = to

    params["project_id"] = project_id

    params["cursor"] = cursor

    params["limit"] = limit

    params["virtual_key_id"] = virtual_key_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/spend-summaries",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1SpendSummariesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1SpendSummariesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1SpendSummariesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1SpendSummariesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1SpendSummariesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
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
    client: AuthenticatedClient | Client,
    group_by: GetApiGatewayV1SpendSummariesGroupBy,
    from_: int,
    to: int,
    project_id: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
    virtual_key_id: str | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
]:
    """Reconciliation checksum fast path: per-key spend rollups grouped by virtual key or end user, with
    token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as
    settled_count and never included in cost sums. Diff individual items via /spend-events only when a
    checksum diverges. Paged by group key ascending: follow next_cursor until it comes back null,
    because a page that is full does not mean the window held nothing more.

    Args:
        group_by (GetApiGatewayV1SpendSummariesGroupBy):
        from_ (int):
        to (int):
        project_id (str | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500]
    """

    kwargs = _get_kwargs(
        group_by=group_by,
        from_=from_,
        to=to,
        project_id=project_id,
        cursor=cursor,
        limit=limit,
        virtual_key_id=virtual_key_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    group_by: GetApiGatewayV1SpendSummariesGroupBy,
    from_: int,
    to: int,
    project_id: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
    virtual_key_id: str | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
    | None
):
    """Reconciliation checksum fast path: per-key spend rollups grouped by virtual key or end user, with
    token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as
    settled_count and never included in cost sums. Diff individual items via /spend-events only when a
    checksum diverges. Paged by group key ascending: follow next_cursor until it comes back null,
    because a page that is full does not mean the window held nothing more.

    Args:
        group_by (GetApiGatewayV1SpendSummariesGroupBy):
        from_ (int):
        to (int):
        project_id (str | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500
    """

    return sync_detailed(
        client=client,
        group_by=group_by,
        from_=from_,
        to=to,
        project_id=project_id,
        cursor=cursor,
        limit=limit,
        virtual_key_id=virtual_key_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    group_by: GetApiGatewayV1SpendSummariesGroupBy,
    from_: int,
    to: int,
    project_id: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
    virtual_key_id: str | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
]:
    """Reconciliation checksum fast path: per-key spend rollups grouped by virtual key or end user, with
    token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as
    settled_count and never included in cost sums. Diff individual items via /spend-events only when a
    checksum diverges. Paged by group key ascending: follow next_cursor until it comes back null,
    because a page that is full does not mean the window held nothing more.

    Args:
        group_by (GetApiGatewayV1SpendSummariesGroupBy):
        from_ (int):
        to (int):
        project_id (str | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500]
    """

    kwargs = _get_kwargs(
        group_by=group_by,
        from_=from_,
        to=to,
        project_id=project_id,
        cursor=cursor,
        limit=limit,
        virtual_key_id=virtual_key_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    group_by: GetApiGatewayV1SpendSummariesGroupBy,
    from_: int,
    to: int,
    project_id: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
    virtual_key_id: str | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
    | None
):
    """Reconciliation checksum fast path: per-key spend rollups grouped by virtual key or end user, with
    token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as
    settled_count and never included in cost sums. Diff individual items via /spend-events only when a
    checksum diverges. Paged by group key ascending: follow next_cursor until it comes back null,
    because a page that is full does not mean the window held nothing more.

    Args:
        group_by (GetApiGatewayV1SpendSummariesGroupBy):
        from_ (int):
        to (int):
        project_id (str | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            group_by=group_by,
            from_=from_,
            to=to,
            project_id=project_id,
            cursor=cursor,
            limit=limit,
            virtual_key_id=virtual_key_id,
        )
    ).parsed
