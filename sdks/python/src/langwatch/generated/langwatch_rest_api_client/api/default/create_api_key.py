from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_api_key_body import CreateApiKeyBody
from ...models.create_api_key_response_201 import CreateApiKeyResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: CreateApiKeyBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/api-keys",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | CreateApiKeyResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateApiKeyResponse201.from_dict(response.json())

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
) -> Response[Any | CreateApiKeyResponse201]:
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
    body: CreateApiKeyBody,
) -> Response[Any | CreateApiKeyResponse201]:
    r"""Create an API key

     Create a new API key. For service keys, pass keyType:\"service\". Optionally scope to specific
    projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId
    to mint the key for another member, and permissionMode:\"restricted\" with a permissions list to
    grant exactly those permissions. Minting a service key or a key for another member requires
    organization admin rights. The plaintext token is returned once — store it securely.

    Args:
        body (CreateApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateApiKeyResponse201]
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
    body: CreateApiKeyBody,
) -> Any | CreateApiKeyResponse201 | None:
    r"""Create an API key

     Create a new API key. For service keys, pass keyType:\"service\". Optionally scope to specific
    projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId
    to mint the key for another member, and permissionMode:\"restricted\" with a permissions list to
    grant exactly those permissions. Minting a service key or a key for another member requires
    organization admin rights. The plaintext token is returned once — store it securely.

    Args:
        body (CreateApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateApiKeyResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateApiKeyBody,
) -> Response[Any | CreateApiKeyResponse201]:
    r"""Create an API key

     Create a new API key. For service keys, pass keyType:\"service\". Optionally scope to specific
    projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId
    to mint the key for another member, and permissionMode:\"restricted\" with a permissions list to
    grant exactly those permissions. Minting a service key or a key for another member requires
    organization admin rights. The plaintext token is returned once — store it securely.

    Args:
        body (CreateApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateApiKeyResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateApiKeyBody,
) -> Any | CreateApiKeyResponse201 | None:
    r"""Create an API key

     Create a new API key. For service keys, pass keyType:\"service\". Optionally scope to specific
    projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId
    to mint the key for another member, and permissionMode:\"restricted\" with a permissions list to
    grant exactly those permissions. Minting a service key or a key for another member requires
    organization admin rights. The plaintext token is returned once — store it securely.

    Args:
        body (CreateApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateApiKeyResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
