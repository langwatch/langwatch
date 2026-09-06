from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_organization_members_include_disabled import ListOrganizationMembersIncludeDisabled
from ...models.list_organization_members_response_200 import ListOrganizationMembersResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    include_disabled: ListOrganizationMembersIncludeDisabled | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_include_disabled: str | Unset = UNSET
    if not isinstance(include_disabled, Unset):
        json_include_disabled = include_disabled.value

    params["includeDisabled"] = json_include_disabled

    params["offset"] = offset

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/organization/members",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListOrganizationMembersResponse200 | None:
    if response.status_code == 200:
        response_200 = ListOrganizationMembersResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListOrganizationMembersResponse200]:
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
    include_disabled: ListOrganizationMembersIncludeDisabled | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[ListOrganizationMembersResponse200]:
    """List the organization's members with their organization role and disabled status. Disabled members
    are included only when includeDisabled=true.

    Args:
        include_disabled (ListOrganizationMembersIncludeDisabled | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListOrganizationMembersResponse200]
    """

    kwargs = _get_kwargs(
        include_disabled=include_disabled,
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
    include_disabled: ListOrganizationMembersIncludeDisabled | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> ListOrganizationMembersResponse200 | None:
    """List the organization's members with their organization role and disabled status. Disabled members
    are included only when includeDisabled=true.

    Args:
        include_disabled (ListOrganizationMembersIncludeDisabled | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListOrganizationMembersResponse200
    """

    return sync_detailed(
        client=client,
        include_disabled=include_disabled,
        offset=offset,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    include_disabled: ListOrganizationMembersIncludeDisabled | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[ListOrganizationMembersResponse200]:
    """List the organization's members with their organization role and disabled status. Disabled members
    are included only when includeDisabled=true.

    Args:
        include_disabled (ListOrganizationMembersIncludeDisabled | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListOrganizationMembersResponse200]
    """

    kwargs = _get_kwargs(
        include_disabled=include_disabled,
        offset=offset,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    include_disabled: ListOrganizationMembersIncludeDisabled | Unset = UNSET,
    offset: int | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> ListOrganizationMembersResponse200 | None:
    """List the organization's members with their organization role and disabled status. Disabled members
    are included only when includeDisabled=true.

    Args:
        include_disabled (ListOrganizationMembersIncludeDisabled | Unset):
        offset (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListOrganizationMembersResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            include_disabled=include_disabled,
            offset=offset,
            limit=limit,
        )
    ).parsed
