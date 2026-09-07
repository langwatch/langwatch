from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_create_group_response_201 import ScimCreateGroupResponse201
from ...models.scim_create_group_response_400 import ScimCreateGroupResponse400
from ...models.scim_create_group_response_401 import ScimCreateGroupResponse401
from ...models.scim_create_group_response_403 import ScimCreateGroupResponse403
from ...models.scim_create_group_response_409 import ScimCreateGroupResponse409
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/scim/v2/Groups",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ScimCreateGroupResponse201
    | ScimCreateGroupResponse400
    | ScimCreateGroupResponse401
    | ScimCreateGroupResponse403
    | ScimCreateGroupResponse409
    | None
):
    if response.status_code == 201:
        response_201 = ScimCreateGroupResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = ScimCreateGroupResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ScimCreateGroupResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ScimCreateGroupResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = ScimCreateGroupResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ScimCreateGroupResponse201
    | ScimCreateGroupResponse400
    | ScimCreateGroupResponse401
    | ScimCreateGroupResponse403
    | ScimCreateGroupResponse409
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
    *,
    client: AuthenticatedClient,
) -> Response[
    ScimCreateGroupResponse201
    | ScimCreateGroupResponse400
    | ScimCreateGroupResponse401
    | ScimCreateGroupResponse403
    | ScimCreateGroupResponse409
]:
    """Provision a group

     Creates an access group. Members are given as LangWatch user ids, the same ids the Users endpoints
    return; an id that is not a member of the organization is skipped rather than failing the call, so a
    group can be provisioned before everyone in it is. Granting the group access is a separate step: a
    group carries no permissions until a role binding is created for it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimCreateGroupResponse201 | ScimCreateGroupResponse400 | ScimCreateGroupResponse401 | ScimCreateGroupResponse403 | ScimCreateGroupResponse409]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    ScimCreateGroupResponse201
    | ScimCreateGroupResponse400
    | ScimCreateGroupResponse401
    | ScimCreateGroupResponse403
    | ScimCreateGroupResponse409
    | None
):
    """Provision a group

     Creates an access group. Members are given as LangWatch user ids, the same ids the Users endpoints
    return; an id that is not a member of the organization is skipped rather than failing the call, so a
    group can be provisioned before everyone in it is. Granting the group access is a separate step: a
    group carries no permissions until a role binding is created for it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimCreateGroupResponse201 | ScimCreateGroupResponse400 | ScimCreateGroupResponse401 | ScimCreateGroupResponse403 | ScimCreateGroupResponse409
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    ScimCreateGroupResponse201
    | ScimCreateGroupResponse400
    | ScimCreateGroupResponse401
    | ScimCreateGroupResponse403
    | ScimCreateGroupResponse409
]:
    """Provision a group

     Creates an access group. Members are given as LangWatch user ids, the same ids the Users endpoints
    return; an id that is not a member of the organization is skipped rather than failing the call, so a
    group can be provisioned before everyone in it is. Granting the group access is a separate step: a
    group carries no permissions until a role binding is created for it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimCreateGroupResponse201 | ScimCreateGroupResponse400 | ScimCreateGroupResponse401 | ScimCreateGroupResponse403 | ScimCreateGroupResponse409]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    ScimCreateGroupResponse201
    | ScimCreateGroupResponse400
    | ScimCreateGroupResponse401
    | ScimCreateGroupResponse403
    | ScimCreateGroupResponse409
    | None
):
    """Provision a group

     Creates an access group. Members are given as LangWatch user ids, the same ids the Users endpoints
    return; an id that is not a member of the organization is skipped rather than failing the call, so a
    group can be provisioned before everyone in it is. Granting the group access is a separate step: a
    group carries no permissions until a role binding is created for it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimCreateGroupResponse201 | ScimCreateGroupResponse400 | ScimCreateGroupResponse401 | ScimCreateGroupResponse403 | ScimCreateGroupResponse409
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
