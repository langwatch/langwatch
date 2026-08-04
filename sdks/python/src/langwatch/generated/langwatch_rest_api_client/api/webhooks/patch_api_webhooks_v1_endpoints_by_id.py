from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_webhooks_v1_endpoints_by_id_body import PatchApiWebhooksV1EndpointsByIdBody
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_200 import PatchApiWebhooksV1EndpointsByIdResponse200
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_400 import PatchApiWebhooksV1EndpointsByIdResponse400
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_401 import PatchApiWebhooksV1EndpointsByIdResponse401
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_403 import PatchApiWebhooksV1EndpointsByIdResponse403
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_404 import PatchApiWebhooksV1EndpointsByIdResponse404
from ...models.patch_api_webhooks_v1_endpoints_by_id_response_500 import PatchApiWebhooksV1EndpointsByIdResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PatchApiWebhooksV1EndpointsByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/webhooks/v1/endpoints/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiWebhooksV1EndpointsByIdResponse200
    | PatchApiWebhooksV1EndpointsByIdResponse400
    | PatchApiWebhooksV1EndpointsByIdResponse401
    | PatchApiWebhooksV1EndpointsByIdResponse403
    | PatchApiWebhooksV1EndpointsByIdResponse404
    | PatchApiWebhooksV1EndpointsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiWebhooksV1EndpointsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiWebhooksV1EndpointsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiWebhooksV1EndpointsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiWebhooksV1EndpointsByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PatchApiWebhooksV1EndpointsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PatchApiWebhooksV1EndpointsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiWebhooksV1EndpointsByIdResponse200
    | PatchApiWebhooksV1EndpointsByIdResponse400
    | PatchApiWebhooksV1EndpointsByIdResponse401
    | PatchApiWebhooksV1EndpointsByIdResponse403
    | PatchApiWebhooksV1EndpointsByIdResponse404
    | PatchApiWebhooksV1EndpointsByIdResponse500
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
    body: PatchApiWebhooksV1EndpointsByIdBody | Unset = UNSET,
) -> Response[
    PatchApiWebhooksV1EndpointsByIdResponse200
    | PatchApiWebhooksV1EndpointsByIdResponse400
    | PatchApiWebhooksV1EndpointsByIdResponse401
    | PatchApiWebhooksV1EndpointsByIdResponse403
    | PatchApiWebhooksV1EndpointsByIdResponse404
    | PatchApiWebhooksV1EndpointsByIdResponse500
]:
    """Update a webhook endpoint

     Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it)

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiWebhooksV1EndpointsByIdResponse200 | PatchApiWebhooksV1EndpointsByIdResponse400 | PatchApiWebhooksV1EndpointsByIdResponse401 | PatchApiWebhooksV1EndpointsByIdResponse403 | PatchApiWebhooksV1EndpointsByIdResponse404 | PatchApiWebhooksV1EndpointsByIdResponse500]
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
    client: AuthenticatedClient | Client,
    body: PatchApiWebhooksV1EndpointsByIdBody | Unset = UNSET,
) -> (
    PatchApiWebhooksV1EndpointsByIdResponse200
    | PatchApiWebhooksV1EndpointsByIdResponse400
    | PatchApiWebhooksV1EndpointsByIdResponse401
    | PatchApiWebhooksV1EndpointsByIdResponse403
    | PatchApiWebhooksV1EndpointsByIdResponse404
    | PatchApiWebhooksV1EndpointsByIdResponse500
    | None
):
    """Update a webhook endpoint

     Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it)

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiWebhooksV1EndpointsByIdResponse200 | PatchApiWebhooksV1EndpointsByIdResponse400 | PatchApiWebhooksV1EndpointsByIdResponse401 | PatchApiWebhooksV1EndpointsByIdResponse403 | PatchApiWebhooksV1EndpointsByIdResponse404 | PatchApiWebhooksV1EndpointsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PatchApiWebhooksV1EndpointsByIdBody | Unset = UNSET,
) -> Response[
    PatchApiWebhooksV1EndpointsByIdResponse200
    | PatchApiWebhooksV1EndpointsByIdResponse400
    | PatchApiWebhooksV1EndpointsByIdResponse401
    | PatchApiWebhooksV1EndpointsByIdResponse403
    | PatchApiWebhooksV1EndpointsByIdResponse404
    | PatchApiWebhooksV1EndpointsByIdResponse500
]:
    """Update a webhook endpoint

     Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it)

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiWebhooksV1EndpointsByIdResponse200 | PatchApiWebhooksV1EndpointsByIdResponse400 | PatchApiWebhooksV1EndpointsByIdResponse401 | PatchApiWebhooksV1EndpointsByIdResponse403 | PatchApiWebhooksV1EndpointsByIdResponse404 | PatchApiWebhooksV1EndpointsByIdResponse500]
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
    client: AuthenticatedClient | Client,
    body: PatchApiWebhooksV1EndpointsByIdBody | Unset = UNSET,
) -> (
    PatchApiWebhooksV1EndpointsByIdResponse200
    | PatchApiWebhooksV1EndpointsByIdResponse400
    | PatchApiWebhooksV1EndpointsByIdResponse401
    | PatchApiWebhooksV1EndpointsByIdResponse403
    | PatchApiWebhooksV1EndpointsByIdResponse404
    | PatchApiWebhooksV1EndpointsByIdResponse500
    | None
):
    """Update a webhook endpoint

     Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled`
    pauses; re-enabling does not re-send the gap, replay covers it)

    Args:
        id (str):
        body (PatchApiWebhooksV1EndpointsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiWebhooksV1EndpointsByIdResponse200 | PatchApiWebhooksV1EndpointsByIdResponse400 | PatchApiWebhooksV1EndpointsByIdResponse401 | PatchApiWebhooksV1EndpointsByIdResponse403 | PatchApiWebhooksV1EndpointsByIdResponse404 | PatchApiWebhooksV1EndpointsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
