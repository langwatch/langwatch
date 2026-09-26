from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_webhooks_v1_endpoints_response_200_item_type_0 import (
    GetApiWebhooksV1EndpointsResponse200ItemType0,
)
from ...models.get_api_webhooks_v1_endpoints_response_200_item_type_1 import (
    GetApiWebhooksV1EndpointsResponse200ItemType1,
)
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/webhooks/v1/endpoints",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:

            def _parse_response_200_item(
                data: object,
            ) -> GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    response_200_item_type_0 = GetApiWebhooksV1EndpointsResponse200ItemType0.from_dict(data)

                    return response_200_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_item_type_1 = GetApiWebhooksV1EndpointsResponse200ItemType1.from_dict(data)

                return response_200_item_type_1

            response_200_item = _parse_response_200_item(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]]:
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
) -> Response[list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]]:
    """List webhook endpoints

     List the organization's webhook endpoints

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1] | None:
    """List webhook endpoints

     List the organization's webhook endpoints

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]]:
    """List webhook endpoints

     List the organization's webhook endpoints

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1] | None:
    """List webhook endpoints

     List the organization's webhook endpoints

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        list[GetApiWebhooksV1EndpointsResponse200ItemType0 | GetApiWebhooksV1EndpointsResponse200ItemType1]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
