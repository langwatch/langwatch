from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_400 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse400,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_401 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse401,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_403 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse403,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_404 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse404,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_500 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/webhooks/v1/endpoints/{id}/roll-secret".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse400
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse401
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse403
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse404
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiWebhooksV1EndpointsByIdRollSecretResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiWebhooksV1EndpointsByIdRollSecretResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiWebhooksV1EndpointsByIdRollSecretResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiWebhooksV1EndpointsByIdRollSecretResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiWebhooksV1EndpointsByIdRollSecretResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PostApiWebhooksV1EndpointsByIdRollSecretResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse400
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse401
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse403
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse404
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
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
    client: AuthenticatedClient,
) -> Response[
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse400
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse401
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse403
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse404
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
]:
    """Roll an endpoint's signing secret

     Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it
    immediately.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsByIdRollSecretResponse200 | PostApiWebhooksV1EndpointsByIdRollSecretResponse400 | PostApiWebhooksV1EndpointsByIdRollSecretResponse401 | PostApiWebhooksV1EndpointsByIdRollSecretResponse403 | PostApiWebhooksV1EndpointsByIdRollSecretResponse404 | PostApiWebhooksV1EndpointsByIdRollSecretResponse500]
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
) -> (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse400
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse401
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse403
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse404
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
    | None
):
    """Roll an endpoint's signing secret

     Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it
    immediately.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200 | PostApiWebhooksV1EndpointsByIdRollSecretResponse400 | PostApiWebhooksV1EndpointsByIdRollSecretResponse401 | PostApiWebhooksV1EndpointsByIdRollSecretResponse403 | PostApiWebhooksV1EndpointsByIdRollSecretResponse404 | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse400
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse401
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse403
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse404
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
]:
    """Roll an endpoint's signing secret

     Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it
    immediately.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWebhooksV1EndpointsByIdRollSecretResponse200 | PostApiWebhooksV1EndpointsByIdRollSecretResponse400 | PostApiWebhooksV1EndpointsByIdRollSecretResponse401 | PostApiWebhooksV1EndpointsByIdRollSecretResponse403 | PostApiWebhooksV1EndpointsByIdRollSecretResponse404 | PostApiWebhooksV1EndpointsByIdRollSecretResponse500]
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
) -> (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse400
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse401
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse403
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse404
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
    | None
):
    """Roll an endpoint's signing secret

     Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it
    immediately.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200 | PostApiWebhooksV1EndpointsByIdRollSecretResponse400 | PostApiWebhooksV1EndpointsByIdRollSecretResponse401 | PostApiWebhooksV1EndpointsByIdRollSecretResponse403 | PostApiWebhooksV1EndpointsByIdRollSecretResponse404 | PostApiWebhooksV1EndpointsByIdRollSecretResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
