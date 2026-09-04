from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_role_body import CreateRoleBody
from ...models.create_role_response_201 import CreateRoleResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: CreateRoleBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/roles",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> CreateRoleResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateRoleResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CreateRoleResponse201]:
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
    body: CreateRoleBody,
) -> Response[CreateRoleResponse201]:
    """Create a custom role from resource:action permission keys. The name is unique within the
    organization; a taken name answers 409 custom_role_name_taken.

    Args:
        body (CreateRoleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateRoleResponse201]
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
    body: CreateRoleBody,
) -> CreateRoleResponse201 | None:
    """Create a custom role from resource:action permission keys. The name is unique within the
    organization; a taken name answers 409 custom_role_name_taken.

    Args:
        body (CreateRoleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateRoleResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateRoleBody,
) -> Response[CreateRoleResponse201]:
    """Create a custom role from resource:action permission keys. The name is unique within the
    organization; a taken name answers 409 custom_role_name_taken.

    Args:
        body (CreateRoleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateRoleResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateRoleBody,
) -> CreateRoleResponse201 | None:
    """Create a custom role from resource:action permission keys. The name is unique within the
    organization; a taken name answers 409 custom_role_name_taken.

    Args:
        body (CreateRoleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateRoleResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
