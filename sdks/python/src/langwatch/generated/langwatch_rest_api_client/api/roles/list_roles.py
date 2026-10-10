from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_roles_built_in import ListRolesBuiltIn
from ...models.list_roles_response_200 import ListRolesResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    built_in: ListRolesBuiltIn | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_built_in: str | Unset = UNSET
    if not isinstance(built_in, Unset):
        json_built_in = built_in.value

    params["builtIn"] = json_built_in

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/roles",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ListRolesResponse200 | None:
    if response.status_code == 200:
        response_200 = ListRolesResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListRolesResponse200]:
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
    built_in: ListRolesBuiltIn | Unset = UNSET,
) -> Response[ListRolesResponse200]:
    """List the organization's roles with their permission sets: the built-in roles `admin`, `member` and
    `viewer` first (marked `builtIn`), then the custom roles. `?builtIn=true` lists only the built-in
    roles, `?builtIn=false` only the custom ones.

    Args:
        built_in (ListRolesBuiltIn | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListRolesResponse200]
    """

    kwargs = _get_kwargs(
        built_in=built_in,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    built_in: ListRolesBuiltIn | Unset = UNSET,
) -> ListRolesResponse200 | None:
    """List the organization's roles with their permission sets: the built-in roles `admin`, `member` and
    `viewer` first (marked `builtIn`), then the custom roles. `?builtIn=true` lists only the built-in
    roles, `?builtIn=false` only the custom ones.

    Args:
        built_in (ListRolesBuiltIn | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListRolesResponse200
    """

    return sync_detailed(
        client=client,
        built_in=built_in,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    built_in: ListRolesBuiltIn | Unset = UNSET,
) -> Response[ListRolesResponse200]:
    """List the organization's roles with their permission sets: the built-in roles `admin`, `member` and
    `viewer` first (marked `builtIn`), then the custom roles. `?builtIn=true` lists only the built-in
    roles, `?builtIn=false` only the custom ones.

    Args:
        built_in (ListRolesBuiltIn | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListRolesResponse200]
    """

    kwargs = _get_kwargs(
        built_in=built_in,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    built_in: ListRolesBuiltIn | Unset = UNSET,
) -> ListRolesResponse200 | None:
    """List the organization's roles with their permission sets: the built-in roles `admin`, `member` and
    `viewer` first (marked `builtIn`), then the custom roles. `?builtIn=true` lists only the built-in
    roles, `?builtIn=false` only the custom ones.

    Args:
        built_in (ListRolesBuiltIn | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListRolesResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            built_in=built_in,
        )
    ).parsed
