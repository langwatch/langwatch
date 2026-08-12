from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_spend_events_response_200 import GetApiGatewayV1SpendEventsResponse200
from ...models.get_api_gateway_v1_spend_events_response_400 import GetApiGatewayV1SpendEventsResponse400
from ...models.get_api_gateway_v1_spend_events_response_401 import GetApiGatewayV1SpendEventsResponse401
from ...models.get_api_gateway_v1_spend_events_response_403 import GetApiGatewayV1SpendEventsResponse403
from ...models.get_api_gateway_v1_spend_events_response_500 import GetApiGatewayV1SpendEventsResponse500
from ...models.get_api_gateway_v1_spend_events_status import GetApiGatewayV1SpendEventsStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    virtual_key_id: str | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    model: str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["from"] = from_

    params["to"] = to

    params["cursor"] = cursor

    params["limit"] = limit

    params["virtual_key_id"] = virtual_key_id

    params["end_user_id"] = end_user_id

    params["project_id"] = project_id

    params["model"] = model

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/spend-events",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1SpendEventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1SpendEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1SpendEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1SpendEventsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1SpendEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
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
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    virtual_key_id: str | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    model: str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
]:
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days, Stripe meters 24h+): re-pulling older
    ranges into a biller past its window can double-bill.

    Args:
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        virtual_key_id (str | Unset):
        end_user_id (str | Unset):
        project_id (str | Unset):
        model (str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500]
    """

    kwargs = _get_kwargs(
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
        virtual_key_id=virtual_key_id,
        end_user_id=end_user_id,
        project_id=project_id,
        model=model,
        status=status,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    virtual_key_id: str | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    model: str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
    | None
):
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days, Stripe meters 24h+): re-pulling older
    ranges into a biller past its window can double-bill.

    Args:
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        virtual_key_id (str | Unset):
        end_user_id (str | Unset):
        project_id (str | Unset):
        model (str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500
    """

    return sync_detailed(
        client=client,
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
        virtual_key_id=virtual_key_id,
        end_user_id=end_user_id,
        project_id=project_id,
        model=model,
        status=status,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    virtual_key_id: str | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    model: str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
]:
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days, Stripe meters 24h+): re-pulling older
    ranges into a biller past its window can double-bill.

    Args:
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        virtual_key_id (str | Unset):
        end_user_id (str | Unset):
        project_id (str | Unset):
        model (str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500]
    """

    kwargs = _get_kwargs(
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
        virtual_key_id=virtual_key_id,
        end_user_id=end_user_id,
        project_id=project_id,
        model=model,
        status=status,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    virtual_key_id: str | Unset = UNSET,
    end_user_id: str | Unset = UNSET,
    project_id: str | Unset = UNSET,
    model: str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
    | None
):
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days, Stripe meters 24h+): re-pulling older
    ranges into a biller past its window can double-bill.

    Args:
        from_ (int):
        to (int):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        virtual_key_id (str | Unset):
        end_user_id (str | Unset):
        project_id (str | Unset):
        model (str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            from_=from_,
            to=to,
            cursor=cursor,
            limit=limit,
            virtual_key_id=virtual_key_id,
            end_user_id=end_user_id,
            project_id=project_id,
            model=model,
            status=status,
        )
    ).parsed
