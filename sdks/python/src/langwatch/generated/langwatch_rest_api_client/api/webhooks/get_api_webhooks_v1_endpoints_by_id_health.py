from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_webhooks_v1_endpoints_by_id_health_response_200 import (
    GetApiWebhooksV1EndpointsByIdHealthResponse200,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/webhooks/v1/endpoints/{id}/health".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiWebhooksV1EndpointsByIdHealthResponse200 | None:
    if response.status_code == 200:
        response_200 = GetApiWebhooksV1EndpointsByIdHealthResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiWebhooksV1EndpointsByIdHealthResponse200]:
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
) -> Response[GetApiWebhooksV1EndpointsByIdHealthResponse200]:
    """Read an endpoint's delivery health

     Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the
    oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success
    rate, and p95 latency over the last hour.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiWebhooksV1EndpointsByIdHealthResponse200]
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
    client: AuthenticatedClient,
) -> GetApiWebhooksV1EndpointsByIdHealthResponse200 | None:
    """Read an endpoint's delivery health

     Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the
    oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success
    rate, and p95 latency over the last hour.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiWebhooksV1EndpointsByIdHealthResponse200
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiWebhooksV1EndpointsByIdHealthResponse200]:
    """Read an endpoint's delivery health

     Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the
    oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success
    rate, and p95 latency over the last hour.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiWebhooksV1EndpointsByIdHealthResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> GetApiWebhooksV1EndpointsByIdHealthResponse200 | None:
    """Read an endpoint's delivery health

     Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the
    oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success
    rate, and p95 latency over the last hour.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiWebhooksV1EndpointsByIdHealthResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
