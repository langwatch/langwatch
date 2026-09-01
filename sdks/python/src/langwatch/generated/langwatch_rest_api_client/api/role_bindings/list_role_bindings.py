from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_role_bindings_response_200 import ListRoleBindingsResponse200
from ...models.list_role_bindings_scope_type import ListRoleBindingsScopeType
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    user_id: str | Unset = UNSET,
    group_id: str | Unset = UNSET,
    api_key_id: str | Unset = UNSET,
    scope_type: ListRoleBindingsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["userId"] = user_id

    params["groupId"] = group_id

    params["apiKeyId"] = api_key_id

    json_scope_type: str | Unset = UNSET
    if not isinstance(scope_type, Unset):
        json_scope_type = scope_type.value

    params["scopeType"] = json_scope_type

    params["scopeId"] = scope_id

    params["offset"] = offset

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/role-bindings",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListRoleBindingsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListRoleBindingsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListRoleBindingsResponse200]:
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
    user_id: str | Unset = UNSET,
    group_id: str | Unset = UNSET,
    api_key_id: str | Unset = UNSET,
    scope_type: ListRoleBindingsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[ListRoleBindingsResponse200]:
    """List the organization's role bindings, each naming its principal (user, group or API key), role and
    scope. Filter by principal or scope; totalCount counts the filtered set.

    Args:
        user_id (str | Unset):
        group_id (str | Unset):
        api_key_id (str | Unset):
        scope_type (ListRoleBindingsScopeType | Unset):
        scope_id (str | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListRoleBindingsResponse200]
    """

    kwargs = _get_kwargs(
        user_id=user_id,
        group_id=group_id,
        api_key_id=api_key_id,
        scope_type=scope_type,
        scope_id=scope_id,
        offset=offset,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    user_id: str | Unset = UNSET,
    group_id: str | Unset = UNSET,
    api_key_id: str | Unset = UNSET,
    scope_type: ListRoleBindingsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> ListRoleBindingsResponse200 | None:
    """List the organization's role bindings, each naming its principal (user, group or API key), role and
    scope. Filter by principal or scope; totalCount counts the filtered set.

    Args:
        user_id (str | Unset):
        group_id (str | Unset):
        api_key_id (str | Unset):
        scope_type (ListRoleBindingsScopeType | Unset):
        scope_id (str | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListRoleBindingsResponse200
    """

    return sync_detailed(
        client=client,
        user_id=user_id,
        group_id=group_id,
        api_key_id=api_key_id,
        scope_type=scope_type,
        scope_id=scope_id,
        offset=offset,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    user_id: str | Unset = UNSET,
    group_id: str | Unset = UNSET,
    api_key_id: str | Unset = UNSET,
    scope_type: ListRoleBindingsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[ListRoleBindingsResponse200]:
    """List the organization's role bindings, each naming its principal (user, group or API key), role and
    scope. Filter by principal or scope; totalCount counts the filtered set.

    Args:
        user_id (str | Unset):
        group_id (str | Unset):
        api_key_id (str | Unset):
        scope_type (ListRoleBindingsScopeType | Unset):
        scope_id (str | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListRoleBindingsResponse200]
    """

    kwargs = _get_kwargs(
        user_id=user_id,
        group_id=group_id,
        api_key_id=api_key_id,
        scope_type=scope_type,
        scope_id=scope_id,
        offset=offset,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    user_id: str | Unset = UNSET,
    group_id: str | Unset = UNSET,
    api_key_id: str | Unset = UNSET,
    scope_type: ListRoleBindingsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> ListRoleBindingsResponse200 | None:
    """List the organization's role bindings, each naming its principal (user, group or API key), role and
    scope. Filter by principal or scope; totalCount counts the filtered set.

    Args:
        user_id (str | Unset):
        group_id (str | Unset):
        api_key_id (str | Unset):
        scope_type (ListRoleBindingsScopeType | Unset):
        scope_id (str | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListRoleBindingsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            user_id=user_id,
            group_id=group_id,
            api_key_id=api_key_id,
            scope_type=scope_type,
            scope_id=scope_id,
            offset=offset,
            limit=limit,
        )
    ).parsed
