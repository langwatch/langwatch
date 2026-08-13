from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.provision_organization_body import ProvisionOrganizationBody
from ...models.provision_organization_response_201 import ProvisionOrganizationResponse201
from ...models.provision_organization_response_401 import ProvisionOrganizationResponse401
from ...models.provision_organization_response_404 import ProvisionOrganizationResponse404
from ...models.provision_organization_response_409 import ProvisionOrganizationResponse409
from ...models.provision_organization_response_422 import ProvisionOrganizationResponse422
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: ProvisionOrganizationBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/organizations",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ProvisionOrganizationResponse201
    | ProvisionOrganizationResponse401
    | ProvisionOrganizationResponse404
    | ProvisionOrganizationResponse409
    | ProvisionOrganizationResponse422
    | None
):
    if response.status_code == 201:
        response_201 = ProvisionOrganizationResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = ProvisionOrganizationResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ProvisionOrganizationResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ProvisionOrganizationResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = ProvisionOrganizationResponse422.from_dict(response.json())

        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ProvisionOrganizationResponse201
    | ProvisionOrganizationResponse401
    | ProvisionOrganizationResponse404
    | ProvisionOrganizationResponse409
    | ProvisionOrganizationResponse422
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
    body: ProvisionOrganizationBody | Unset = UNSET,
) -> Response[
    ProvisionOrganizationResponse201
    | ProvisionOrganizationResponse401
    | ProvisionOrganizationResponse404
    | ProvisionOrganizationResponse409
    | ProvisionOrganizationResponse422
]:
    """Create an organization

     Self-hosted only. Creates an organization with a default team and returns an organization-scoped
    admin API key, so provisioning can continue through the management APIs without a browser step: the
    instance key creates the organization, the returned key does everything else. The slug is the
    natural key; a taken slug answers 409 organization_slug_taken.

    Args:
        body (ProvisionOrganizationBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ProvisionOrganizationResponse201 | ProvisionOrganizationResponse401 | ProvisionOrganizationResponse404 | ProvisionOrganizationResponse409 | ProvisionOrganizationResponse422]
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
    body: ProvisionOrganizationBody | Unset = UNSET,
) -> (
    ProvisionOrganizationResponse201
    | ProvisionOrganizationResponse401
    | ProvisionOrganizationResponse404
    | ProvisionOrganizationResponse409
    | ProvisionOrganizationResponse422
    | None
):
    """Create an organization

     Self-hosted only. Creates an organization with a default team and returns an organization-scoped
    admin API key, so provisioning can continue through the management APIs without a browser step: the
    instance key creates the organization, the returned key does everything else. The slug is the
    natural key; a taken slug answers 409 organization_slug_taken.

    Args:
        body (ProvisionOrganizationBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ProvisionOrganizationResponse201 | ProvisionOrganizationResponse401 | ProvisionOrganizationResponse404 | ProvisionOrganizationResponse409 | ProvisionOrganizationResponse422
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ProvisionOrganizationBody | Unset = UNSET,
) -> Response[
    ProvisionOrganizationResponse201
    | ProvisionOrganizationResponse401
    | ProvisionOrganizationResponse404
    | ProvisionOrganizationResponse409
    | ProvisionOrganizationResponse422
]:
    """Create an organization

     Self-hosted only. Creates an organization with a default team and returns an organization-scoped
    admin API key, so provisioning can continue through the management APIs without a browser step: the
    instance key creates the organization, the returned key does everything else. The slug is the
    natural key; a taken slug answers 409 organization_slug_taken.

    Args:
        body (ProvisionOrganizationBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ProvisionOrganizationResponse201 | ProvisionOrganizationResponse401 | ProvisionOrganizationResponse404 | ProvisionOrganizationResponse409 | ProvisionOrganizationResponse422]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ProvisionOrganizationBody | Unset = UNSET,
) -> (
    ProvisionOrganizationResponse201
    | ProvisionOrganizationResponse401
    | ProvisionOrganizationResponse404
    | ProvisionOrganizationResponse409
    | ProvisionOrganizationResponse422
    | None
):
    """Create an organization

     Self-hosted only. Creates an organization with a default team and returns an organization-scoped
    admin API key, so provisioning can continue through the management APIs without a browser step: the
    instance key creates the organization, the returned key does everything else. The slug is the
    natural key; a taken slug answers 409 organization_slug_taken.

    Args:
        body (ProvisionOrganizationBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ProvisionOrganizationResponse201 | ProvisionOrganizationResponse401 | ProvisionOrganizationResponse404 | ProvisionOrganizationResponse409 | ProvisionOrganizationResponse422
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
