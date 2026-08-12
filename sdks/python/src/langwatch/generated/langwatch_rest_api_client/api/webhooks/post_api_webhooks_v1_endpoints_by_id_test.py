from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_webhooks_v1_endpoints_by_id_test_response_200 import (
    PostApiWebhooksV1EndpointsByIdTestResponse200,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_test_response_400 import (
    PostApiWebhooksV1EndpointsByIdTestResponse400,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_test_response_401 import (
    PostApiWebhooksV1EndpointsByIdTestResponse401,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_test_response_403 import (
    PostApiWebhooksV1EndpointsByIdTestResponse403,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_test_response_404 import (
    PostApiWebhooksV1EndpointsByIdTestResponse404,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_test_response_500 import (
    PostApiWebhooksV1EndpointsByIdTestResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/v1/endpoints/{id}/test".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiWebhooksV1EndpointsByIdTestResponse200
    | PostApiWebhooksV1EndpointsByIdTestResponse400
    | PostApiWebhooksV1EndpointsByIdTestResponse401
    | PostApiWebhooksV1EndpointsByIdTestResponse403
    | PostApiWebhooksV1EndpointsByIdTestResponse404
    | PostApiWebhooksV1EndpointsByIdTestResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiWebhooksV1EndpointsByIdTestResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiWebhooksV1EndpointsByIdTestResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiWebhooksV1EndpointsByIdTestResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiWebhooksV1EndpointsByIdTestResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiWebhooksV1EndpointsByIdTestResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PostApiWebhooksV1EndpointsByIdTestResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiWebhooksV1EndpointsByIdTestResponse200
    | PostApiWebhooksV1EndpointsByIdTestResponse400
    | PostApiWebhooksV1EndpointsByIdTestResponse401
    | PostApiWebhooksV1EndpointsByIdTestResponse403
    | PostApiWebhooksV1EndpointsByIdTestResponse404
    | PostApiWebhooksV1EndpointsByIdTestResponse500
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
) -> Response[
    PostApiWebhooksV1EndpointsByIdTestResponse200
    | PostApiWebhooksV1EndpointsByIdTestResponse400
    | PostApiWebhooksV1EndpointsByIdTestResponse401
    | PostApiWebhooksV1EndpointsByIdTestResponse403
    | PostApiWebhooksV1EndpointsByIdTestResponse404
    | PostApiWebhooksV1EndpointsByIdTestResponse500
]:
    """Send a test event to an endpoint

     Send a signed test event through the full delivery path. Contract: the route answers 200 whenever
    the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsByIdTestResponse200 | PostApiWebhooksV1EndpointsByIdTestResponse400 | PostApiWebhooksV1EndpointsByIdTestResponse401 | PostApiWebhooksV1EndpointsByIdTestResponse403 | PostApiWebhooksV1EndpointsByIdTestResponse404 | PostApiWebhooksV1EndpointsByIdTestResponse500]
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
    client: AuthenticatedClient | Client,
) -> (
    PostApiWebhooksV1EndpointsByIdTestResponse200
    | PostApiWebhooksV1EndpointsByIdTestResponse400
    | PostApiWebhooksV1EndpointsByIdTestResponse401
    | PostApiWebhooksV1EndpointsByIdTestResponse403
    | PostApiWebhooksV1EndpointsByIdTestResponse404
    | PostApiWebhooksV1EndpointsByIdTestResponse500
    | None
):
    """Send a test event to an endpoint

     Send a signed test event through the full delivery path. Contract: the route answers 200 whenever
    the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsByIdTestResponse200 | PostApiWebhooksV1EndpointsByIdTestResponse400 | PostApiWebhooksV1EndpointsByIdTestResponse401 | PostApiWebhooksV1EndpointsByIdTestResponse403 | PostApiWebhooksV1EndpointsByIdTestResponse404 | PostApiWebhooksV1EndpointsByIdTestResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    PostApiWebhooksV1EndpointsByIdTestResponse200
    | PostApiWebhooksV1EndpointsByIdTestResponse400
    | PostApiWebhooksV1EndpointsByIdTestResponse401
    | PostApiWebhooksV1EndpointsByIdTestResponse403
    | PostApiWebhooksV1EndpointsByIdTestResponse404
    | PostApiWebhooksV1EndpointsByIdTestResponse500
]:
    """Send a test event to an endpoint

     Send a signed test event through the full delivery path. Contract: the route answers 200 whenever
    the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsByIdTestResponse200 | PostApiWebhooksV1EndpointsByIdTestResponse400 | PostApiWebhooksV1EndpointsByIdTestResponse401 | PostApiWebhooksV1EndpointsByIdTestResponse403 | PostApiWebhooksV1EndpointsByIdTestResponse404 | PostApiWebhooksV1EndpointsByIdTestResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    PostApiWebhooksV1EndpointsByIdTestResponse200
    | PostApiWebhooksV1EndpointsByIdTestResponse400
    | PostApiWebhooksV1EndpointsByIdTestResponse401
    | PostApiWebhooksV1EndpointsByIdTestResponse403
    | PostApiWebhooksV1EndpointsByIdTestResponse404
    | PostApiWebhooksV1EndpointsByIdTestResponse500
    | None
):
    """Send a test event to an endpoint

     Send a signed test event through the full delivery path. Contract: the route answers 200 whenever
    the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the
    body, not the status code.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsByIdTestResponse200 | PostApiWebhooksV1EndpointsByIdTestResponse400 | PostApiWebhooksV1EndpointsByIdTestResponse401 | PostApiWebhooksV1EndpointsByIdTestResponse403 | PostApiWebhooksV1EndpointsByIdTestResponse404 | PostApiWebhooksV1EndpointsByIdTestResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
