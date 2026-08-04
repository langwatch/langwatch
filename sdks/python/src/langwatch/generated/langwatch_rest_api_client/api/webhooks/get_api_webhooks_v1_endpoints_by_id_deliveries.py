from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_webhooks_v1_endpoints_by_id_deliveries_response_200 import (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200,
)
from ...models.get_api_webhooks_v1_endpoints_by_id_deliveries_response_400 import (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse400,
)
from ...models.get_api_webhooks_v1_endpoints_by_id_deliveries_response_401 import (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse401,
)
from ...models.get_api_webhooks_v1_endpoints_by_id_deliveries_response_403 import (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse403,
)
from ...models.get_api_webhooks_v1_endpoints_by_id_deliveries_response_404 import (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse404,
)
from ...models.get_api_webhooks_v1_endpoints_by_id_deliveries_response_500 import (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["cursor"] = cursor

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/webhooks/v1/endpoints/{id}/deliveries".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiWebhooksV1EndpointsByIdDeliveriesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiWebhooksV1EndpointsByIdDeliveriesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiWebhooksV1EndpointsByIdDeliveriesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiWebhooksV1EndpointsByIdDeliveriesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiWebhooksV1EndpointsByIdDeliveriesResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetApiWebhooksV1EndpointsByIdDeliveriesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
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
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
]:
    """List an endpoint's delivery attempts

     The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error

    Args:
        id (str):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiWebhooksV1EndpointsByIdDeliveriesResponse200 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        cursor=cursor,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
    | None
):
    """List an endpoint's delivery attempts

     The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error

    Args:
        id (str):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiWebhooksV1EndpointsByIdDeliveriesResponse200 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        cursor=cursor,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
]:
    """List an endpoint's delivery attempts

     The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error

    Args:
        id (str):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiWebhooksV1EndpointsByIdDeliveriesResponse200 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        cursor=cursor,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> (
    GetApiWebhooksV1EndpointsByIdDeliveriesResponse200
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404
    | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
    | None
):
    """List an endpoint's delivery attempts

     The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error

    Args:
        id (str):
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiWebhooksV1EndpointsByIdDeliveriesResponse200 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse400 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse401 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse403 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse404 | GetApiWebhooksV1EndpointsByIdDeliveriesResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            cursor=cursor,
            limit=limit,
        )
    ).parsed
