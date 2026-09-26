from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_webhooks_v1_endpoints_by_id_body import PatchApiWebhooksV1EndpointsByIdBody
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_200_type_0 import (
    PatchApiWebhooksV1EndpointsByIdResponse200Type0,
)
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_200_type_1 import (
    PatchApiWebhooksV1EndpointsByIdResponse200Type1,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PatchApiWebhooksV1EndpointsByIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/webhooks/v1/endpoints/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1 | None:
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = PatchApiWebhooksV1EndpointsByIdResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = PatchApiWebhooksV1EndpointsByIdResponse200Type1.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1]:
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
    body: PatchApiWebhooksV1EndpointsByIdBody,
) -> Response[PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1]:
    """Update a webhook endpoint

     Update a webhook endpoint's address, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). `destination_kind` cannot change:
    batches already planned against the old transport are in flight, so a move means a new endpoint
    alongside this one until it has drained.

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1]
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
    body: PatchApiWebhooksV1EndpointsByIdBody,
) -> PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1 | None:
    """Update a webhook endpoint

     Update a webhook endpoint's address, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). `destination_kind` cannot change:
    batches already planned against the old transport are in flight, so a move means a new endpoint
    alongside this one until it has drained.

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1
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
    body: PatchApiWebhooksV1EndpointsByIdBody,
) -> Response[PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1]:
    """Update a webhook endpoint

     Update a webhook endpoint's address, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). `destination_kind` cannot change:
    batches already planned against the old transport are in flight, so a move means a new endpoint
    alongside this one until it has drained.

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1]
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
    body: PatchApiWebhooksV1EndpointsByIdBody,
) -> PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1 | None:
    """Update a webhook endpoint

     Update a webhook endpoint's address, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it). `destination_kind` cannot change:
    batches already planned against the old transport are in flight, so a move means a new endpoint
    alongside this one until it has drained.

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiWebhooksV1EndpointsByIdResponse200Type0 | PatchApiWebhooksV1EndpointsByIdResponse200Type1
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
