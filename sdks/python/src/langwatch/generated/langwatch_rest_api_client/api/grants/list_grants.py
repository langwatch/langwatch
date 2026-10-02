from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_grants_order import ListGrantsOrder
from ...models.list_grants_principal_type import ListGrantsPrincipalType
from ...models.list_grants_response_200 import ListGrantsResponse200
from ...models.list_grants_scope_type import ListGrantsScopeType
from ...models.list_grants_status import ListGrantsStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    principal_type: ListGrantsPrincipalType | Unset = UNSET,
    principal_id: str | Unset = UNSET,
    role_id: str | Unset = UNSET,
    scope_type: ListGrantsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    status: ListGrantsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    order: ListGrantsOrder | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_principal_type: str | Unset = UNSET
    if not isinstance(principal_type, Unset):
        json_principal_type = principal_type.value

    params["principalType"] = json_principal_type

    params["principalId"] = principal_id

    params["roleId"] = role_id

    json_scope_type: str | Unset = UNSET
    if not isinstance(scope_type, Unset):
        json_scope_type = scope_type.value

    params["scopeType"] = json_scope_type

    params["scopeId"] = scope_id

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params["limit"] = limit

    params["cursor"] = cursor

    json_order: str | Unset = UNSET
    if not isinstance(order, Unset):
        json_order = order.value

    params["order"] = json_order

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/grants",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ListGrantsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListGrantsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListGrantsResponse200]:
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
    principal_type: ListGrantsPrincipalType | Unset = UNSET,
    principal_id: str | Unset = UNSET,
    role_id: str | Unset = UNSET,
    scope_type: ListGrantsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    status: ListGrantsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    order: ListGrantsOrder | Unset = UNSET,
) -> Response[ListGrantsResponse200]:
    """List grants

     List the organization's grants, oldest first unless `order=newest`, each naming its principal (user,
    group or API key), role and scope. Filter by principal, role, scope or status; `status` is derived
    from `expiresAt`. Pages by cursor: pass `nextCursor` back as `cursor` until it is null.

    Args:
        principal_type (ListGrantsPrincipalType | Unset):
        principal_id (str | Unset):
        role_id (str | Unset):
        scope_type (ListGrantsScopeType | Unset):
        scope_id (str | Unset):
        status (ListGrantsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        order (ListGrantsOrder | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListGrantsResponse200]
    """

    kwargs = _get_kwargs(
        principal_type=principal_type,
        principal_id=principal_id,
        role_id=role_id,
        scope_type=scope_type,
        scope_id=scope_id,
        status=status,
        limit=limit,
        cursor=cursor,
        order=order,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    principal_type: ListGrantsPrincipalType | Unset = UNSET,
    principal_id: str | Unset = UNSET,
    role_id: str | Unset = UNSET,
    scope_type: ListGrantsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    status: ListGrantsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    order: ListGrantsOrder | Unset = UNSET,
) -> ListGrantsResponse200 | None:
    """List grants

     List the organization's grants, oldest first unless `order=newest`, each naming its principal (user,
    group or API key), role and scope. Filter by principal, role, scope or status; `status` is derived
    from `expiresAt`. Pages by cursor: pass `nextCursor` back as `cursor` until it is null.

    Args:
        principal_type (ListGrantsPrincipalType | Unset):
        principal_id (str | Unset):
        role_id (str | Unset):
        scope_type (ListGrantsScopeType | Unset):
        scope_id (str | Unset):
        status (ListGrantsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        order (ListGrantsOrder | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListGrantsResponse200
    """

    return sync_detailed(
        client=client,
        principal_type=principal_type,
        principal_id=principal_id,
        role_id=role_id,
        scope_type=scope_type,
        scope_id=scope_id,
        status=status,
        limit=limit,
        cursor=cursor,
        order=order,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    principal_type: ListGrantsPrincipalType | Unset = UNSET,
    principal_id: str | Unset = UNSET,
    role_id: str | Unset = UNSET,
    scope_type: ListGrantsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    status: ListGrantsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    order: ListGrantsOrder | Unset = UNSET,
) -> Response[ListGrantsResponse200]:
    """List grants

     List the organization's grants, oldest first unless `order=newest`, each naming its principal (user,
    group or API key), role and scope. Filter by principal, role, scope or status; `status` is derived
    from `expiresAt`. Pages by cursor: pass `nextCursor` back as `cursor` until it is null.

    Args:
        principal_type (ListGrantsPrincipalType | Unset):
        principal_id (str | Unset):
        role_id (str | Unset):
        scope_type (ListGrantsScopeType | Unset):
        scope_id (str | Unset):
        status (ListGrantsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        order (ListGrantsOrder | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListGrantsResponse200]
    """

    kwargs = _get_kwargs(
        principal_type=principal_type,
        principal_id=principal_id,
        role_id=role_id,
        scope_type=scope_type,
        scope_id=scope_id,
        status=status,
        limit=limit,
        cursor=cursor,
        order=order,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    principal_type: ListGrantsPrincipalType | Unset = UNSET,
    principal_id: str | Unset = UNSET,
    role_id: str | Unset = UNSET,
    scope_type: ListGrantsScopeType | Unset = UNSET,
    scope_id: str | Unset = UNSET,
    status: ListGrantsStatus | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    order: ListGrantsOrder | Unset = UNSET,
) -> ListGrantsResponse200 | None:
    """List grants

     List the organization's grants, oldest first unless `order=newest`, each naming its principal (user,
    group or API key), role and scope. Filter by principal, role, scope or status; `status` is derived
    from `expiresAt`. Pages by cursor: pass `nextCursor` back as `cursor` until it is null.

    Args:
        principal_type (ListGrantsPrincipalType | Unset):
        principal_id (str | Unset):
        role_id (str | Unset):
        scope_type (ListGrantsScopeType | Unset):
        scope_id (str | Unset):
        status (ListGrantsStatus | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        order (ListGrantsOrder | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListGrantsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            principal_type=principal_type,
            principal_id=principal_id,
            role_id=role_id,
            scope_type=scope_type,
            scope_id=scope_id,
            status=status,
            limit=limit,
            cursor=cursor,
            order=order,
        )
    ).parsed
