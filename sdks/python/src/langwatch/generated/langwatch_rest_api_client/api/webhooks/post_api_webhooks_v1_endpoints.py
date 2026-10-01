from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_webhooks_v1_endpoints_body import PostApiWebhooksV1EndpointsBody
from ...models.post_api_webhooks_v1_endpoints_response_201_type_0 import PostApiWebhooksV1EndpointsResponse201Type0
from ...models.post_api_webhooks_v1_endpoints_response_201_type_1 import PostApiWebhooksV1EndpointsResponse201Type1
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiWebhooksV1EndpointsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

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
) -> PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1 | None:
    if response.status_code == 201:

        def _parse_response_201(
            data: object,
        ) -> PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_201_type_0 = PostApiWebhooksV1EndpointsResponse201Type0.from_dict(data)

                return response_201_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_201_type_1 = PostApiWebhooksV1EndpointsResponse201Type1.from_dict(data)

            return response_201_type_1

        response_201 = _parse_response_201(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1]:
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
) -> Response[PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1]:
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
) -> PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1 | None:
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
) -> Response[PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1]:
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiWebhooksV1EndpointsBody,
) -> PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1 | None:
    """Create a webhook endpoint

     Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for
    `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not
    belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means
    `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new
    one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including
    its `secret`, which is the only way to recover a secret whose response was lost in transit.

    Args:
        body (PostApiWebhooksV1EndpointsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsResponse201Type0 | PostApiWebhooksV1EndpointsResponse201Type1
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
