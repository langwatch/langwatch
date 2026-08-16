from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.update_api_key_body import UpdateApiKeyBody
from ...models.update_api_key_response_200 import UpdateApiKeyResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: UpdateApiKeyBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/api-keys/{id}".format(
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
) -> Any | UpdateApiKeyResponse200 | None:
    if response.status_code == 200:
        response_200 = UpdateApiKeyResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if response.status_code == 409:
        response_409 = cast(Any, None)
        return response_409

    if response.status_code == 422:
        response_422 = cast(Any, None)
        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | UpdateApiKeyResponse200]:
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
    body: UpdateApiKeyBody | Unset = UNSET,
) -> Response[Any | UpdateApiKeyResponse200]:
    """Update an API key

     Update an API key's name, description, permission mode, permissions or bindings. Every field is
    optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns.
    You may update your own keys; organization admins may update any key in the organization. Bindings
    can never exceed the access of the member the key belongs to. The token itself never changes.

    Args:
        id (str):
        body (UpdateApiKeyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | UpdateApiKeyResponse200]
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
    body: UpdateApiKeyBody | Unset = UNSET,
) -> Any | UpdateApiKeyResponse200 | None:
    """Update an API key

     Update an API key's name, description, permission mode, permissions or bindings. Every field is
    optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns.
    You may update your own keys; organization admins may update any key in the organization. Bindings
    can never exceed the access of the member the key belongs to. The token itself never changes.

    Args:
        id (str):
        body (UpdateApiKeyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | UpdateApiKeyResponse200
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
    body: UpdateApiKeyBody | Unset = UNSET,
) -> Response[Any | UpdateApiKeyResponse200]:
    """Update an API key

     Update an API key's name, description, permission mode, permissions or bindings. Every field is
    optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns.
    You may update your own keys; organization admins may update any key in the organization. Bindings
    can never exceed the access of the member the key belongs to. The token itself never changes.

    Args:
        id (str):
        body (UpdateApiKeyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | UpdateApiKeyResponse200]
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
    body: UpdateApiKeyBody | Unset = UNSET,
) -> Any | UpdateApiKeyResponse200 | None:
    """Update an API key

     Update an API key's name, description, permission mode, permissions or bindings. Every field is
    optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns.
    You may update your own keys; organization admins may update any key in the organization. Bindings
    can never exceed the access of the member the key belongs to. The token itself never changes.

    Args:
        id (str):
        body (UpdateApiKeyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | UpdateApiKeyResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
