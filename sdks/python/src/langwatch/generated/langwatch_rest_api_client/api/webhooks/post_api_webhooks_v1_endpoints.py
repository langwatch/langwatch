from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_webhooks_v1_endpoints_body import PostApiWebhooksV1EndpointsBody
from ...models.post_api_webhooks_v1_endpoints_response_201 import PostApiWebhooksV1EndpointsResponse201
from ...models.post_api_webhooks_v1_endpoints_response_400 import PostApiWebhooksV1EndpointsResponse400
from ...models.post_api_webhooks_v1_endpoints_response_401 import PostApiWebhooksV1EndpointsResponse401
from ...models.post_api_webhooks_v1_endpoints_response_403 import PostApiWebhooksV1EndpointsResponse403
from ...models.post_api_webhooks_v1_endpoints_response_409 import PostApiWebhooksV1EndpointsResponse409
from ...models.post_api_webhooks_v1_endpoints_response_500 import PostApiWebhooksV1EndpointsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiWebhooksV1EndpointsBody,
    idempotency_key: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/v1/endpoints",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiWebhooksV1EndpointsResponse201
    | PostApiWebhooksV1EndpointsResponse400
    | PostApiWebhooksV1EndpointsResponse401
    | PostApiWebhooksV1EndpointsResponse403
    | PostApiWebhooksV1EndpointsResponse409
    | PostApiWebhooksV1EndpointsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiWebhooksV1EndpointsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiWebhooksV1EndpointsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiWebhooksV1EndpointsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiWebhooksV1EndpointsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = PostApiWebhooksV1EndpointsResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = PostApiWebhooksV1EndpointsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiWebhooksV1EndpointsResponse201
    | PostApiWebhooksV1EndpointsResponse400
    | PostApiWebhooksV1EndpointsResponse401
    | PostApiWebhooksV1EndpointsResponse403
    | PostApiWebhooksV1EndpointsResponse409
    | PostApiWebhooksV1EndpointsResponse500
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
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
    idempotency_key: str | Unset = UNSET,
) -> Response[
    PostApiWebhooksV1EndpointsResponse201
    | PostApiWebhooksV1EndpointsResponse400
    | PostApiWebhooksV1EndpointsResponse401
    | PostApiWebhooksV1EndpointsResponse403
    | PostApiWebhooksV1EndpointsResponse409
    | PostApiWebhooksV1EndpointsResponse500
]:
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        idempotency_key (str | Unset):
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsResponse201 | PostApiWebhooksV1EndpointsResponse400 | PostApiWebhooksV1EndpointsResponse401 | PostApiWebhooksV1EndpointsResponse403 | PostApiWebhooksV1EndpointsResponse409 | PostApiWebhooksV1EndpointsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
    idempotency_key: str | Unset = UNSET,
) -> (
    PostApiWebhooksV1EndpointsResponse201
    | PostApiWebhooksV1EndpointsResponse400
    | PostApiWebhooksV1EndpointsResponse401
    | PostApiWebhooksV1EndpointsResponse403
    | PostApiWebhooksV1EndpointsResponse409
    | PostApiWebhooksV1EndpointsResponse500
    | None
):
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        idempotency_key (str | Unset):
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsResponse201 | PostApiWebhooksV1EndpointsResponse400 | PostApiWebhooksV1EndpointsResponse401 | PostApiWebhooksV1EndpointsResponse403 | PostApiWebhooksV1EndpointsResponse409 | PostApiWebhooksV1EndpointsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
    idempotency_key: str | Unset = UNSET,
) -> Response[
    PostApiWebhooksV1EndpointsResponse201
    | PostApiWebhooksV1EndpointsResponse400
    | PostApiWebhooksV1EndpointsResponse401
    | PostApiWebhooksV1EndpointsResponse403
    | PostApiWebhooksV1EndpointsResponse409
    | PostApiWebhooksV1EndpointsResponse500
]:
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        idempotency_key (str | Unset):
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsResponse201 | PostApiWebhooksV1EndpointsResponse400 | PostApiWebhooksV1EndpointsResponse401 | PostApiWebhooksV1EndpointsResponse403 | PostApiWebhooksV1EndpointsResponse409 | PostApiWebhooksV1EndpointsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
    idempotency_key: str | Unset = UNSET,
) -> (
    PostApiWebhooksV1EndpointsResponse201
    | PostApiWebhooksV1EndpointsResponse400
    | PostApiWebhooksV1EndpointsResponse401
    | PostApiWebhooksV1EndpointsResponse403
    | PostApiWebhooksV1EndpointsResponse409
    | PostApiWebhooksV1EndpointsResponse500
    | None
):
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        idempotency_key (str | Unset):
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsResponse201 | PostApiWebhooksV1EndpointsResponse400 | PostApiWebhooksV1EndpointsResponse401 | PostApiWebhooksV1EndpointsResponse403 | PostApiWebhooksV1EndpointsResponse409 | PostApiWebhooksV1EndpointsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
