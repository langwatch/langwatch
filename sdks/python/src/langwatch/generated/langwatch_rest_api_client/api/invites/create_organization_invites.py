from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_organization_invites_body import CreateOrganizationInvitesBody
from ...models.create_organization_invites_response_201 import CreateOrganizationInvitesResponse201
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: CreateOrganizationInvitesBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/organization/invites",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CreateOrganizationInvitesResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateOrganizationInvitesResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CreateOrganizationInvitesResponse201]:
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
    body: CreateOrganizationInvitesBody | Unset = UNSET,
) -> Response[CreateOrganizationInvitesResponse201]:
    """Create up to 50 invites in one batch, each with team assignments that may carry a custom role.
    Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than
    silently granting less than was asked. emailNotSent reports, per invite, whether the invite email
    could be delivered.

    Args:
        body (CreateOrganizationInvitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateOrganizationInvitesResponse201]
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
    body: CreateOrganizationInvitesBody | Unset = UNSET,
) -> CreateOrganizationInvitesResponse201 | None:
    """Create up to 50 invites in one batch, each with team assignments that may carry a custom role.
    Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than
    silently granting less than was asked. emailNotSent reports, per invite, whether the invite email
    could be delivered.

    Args:
        body (CreateOrganizationInvitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateOrganizationInvitesResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateOrganizationInvitesBody | Unset = UNSET,
) -> Response[CreateOrganizationInvitesResponse201]:
    """Create up to 50 invites in one batch, each with team assignments that may carry a custom role.
    Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than
    silently granting less than was asked. emailNotSent reports, per invite, whether the invite email
    could be delivered.

    Args:
        body (CreateOrganizationInvitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateOrganizationInvitesResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateOrganizationInvitesBody | Unset = UNSET,
) -> CreateOrganizationInvitesResponse201 | None:
    """Create up to 50 invites in one batch, each with team assignments that may carry a custom role.
    Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than
    silently granting less than was asked. emailNotSent reports, per invite, whether the invite email
    could be delivered.

    Args:
        body (CreateOrganizationInvitesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateOrganizationInvitesResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
