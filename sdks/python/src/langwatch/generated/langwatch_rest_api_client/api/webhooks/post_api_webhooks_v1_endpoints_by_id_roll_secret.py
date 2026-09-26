from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_type_0 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0,
)
from ...models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_type_1 import (
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1,
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
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0
            | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
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
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
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
        Response[PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1]
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
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
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
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
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
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
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
        Response[PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1]
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
    PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0
    | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
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
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type0 | PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
