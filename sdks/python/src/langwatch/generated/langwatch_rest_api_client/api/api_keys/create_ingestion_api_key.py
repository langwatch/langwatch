from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_ingestion_api_key_body import CreateIngestionApiKeyBody
from ...models.create_ingestion_api_key_response_201 import CreateIngestionApiKeyResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: CreateIngestionApiKeyBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/api-keys/ingestion",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | CreateIngestionApiKeyResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateIngestionApiKeyResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 422:
        response_422 = cast(Any, None)
        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | CreateIngestionApiKeyResponse201]:
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
    body: CreateIngestionApiKeyBody,
) -> Response[Any | CreateIngestionApiKeyResponse201]:
    r"""Create an ingestion API key

     Mint the caller's own ingestion key for the project their sign-in session is bound to, as `langwatch
    login --project` does. Only one shape is accepted: keyType \"personal\", owned by the caller, one
    CUSTOM binding to that project, permissionMode \"restricted\" and exactly the ingestion permissions.
    Name it after the machine; omit expiresAt for a key that never expires. Requires a person's project
    session holding traces:create; an API key cannot mint one.

    Args:
        body (CreateIngestionApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateIngestionApiKeyResponse201]
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
    body: CreateIngestionApiKeyBody,
) -> Any | CreateIngestionApiKeyResponse201 | None:
    r"""Create an ingestion API key

     Mint the caller's own ingestion key for the project their sign-in session is bound to, as `langwatch
    login --project` does. Only one shape is accepted: keyType \"personal\", owned by the caller, one
    CUSTOM binding to that project, permissionMode \"restricted\" and exactly the ingestion permissions.
    Name it after the machine; omit expiresAt for a key that never expires. Requires a person's project
    session holding traces:create; an API key cannot mint one.

    Args:
        body (CreateIngestionApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateIngestionApiKeyResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateIngestionApiKeyBody,
) -> Response[Any | CreateIngestionApiKeyResponse201]:
    r"""Create an ingestion API key

     Mint the caller's own ingestion key for the project their sign-in session is bound to, as `langwatch
    login --project` does. Only one shape is accepted: keyType \"personal\", owned by the caller, one
    CUSTOM binding to that project, permissionMode \"restricted\" and exactly the ingestion permissions.
    Name it after the machine; omit expiresAt for a key that never expires. Requires a person's project
    session holding traces:create; an API key cannot mint one.

    Args:
        body (CreateIngestionApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateIngestionApiKeyResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateIngestionApiKeyBody,
) -> Any | CreateIngestionApiKeyResponse201 | None:
    r"""Create an ingestion API key

     Mint the caller's own ingestion key for the project their sign-in session is bound to, as `langwatch
    login --project` does. Only one shape is accepted: keyType \"personal\", owned by the caller, one
    CUSTOM binding to that project, permissionMode \"restricted\" and exactly the ingestion permissions.
    Name it after the machine; omit expiresAt for a key that never expires. Requires a person's project
    session holding traces:create; an API key cannot mint one.

    Args:
        body (CreateIngestionApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateIngestionApiKeyResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
