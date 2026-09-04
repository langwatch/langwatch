from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_organizations_response_200 import ListOrganizationsResponse200
from ...models.list_organizations_response_401 import ListOrganizationsResponse401
from ...models.list_organizations_response_404 import ListOrganizationsResponse404
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/organizations",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404 | None:
    if response.status_code == 200:
        response_200 = ListOrganizationsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ListOrganizationsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ListOrganizationsResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404]:
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
) -> Response[ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404]:
    """List organizations

     Self-hosted only. Lists every organization on this instance, newest first.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404 | None:
    """List organizations

     Self-hosted only. Lists every organization on this instance, newest first.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404]:
    """List organizations

     Self-hosted only. Lists every organization on this instance, newest first.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404 | None:
    """List organizations

     Self-hosted only. Lists every organization on this instance, newest first.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListOrganizationsResponse200 | ListOrganizationsResponse401 | ListOrganizationsResponse404
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
