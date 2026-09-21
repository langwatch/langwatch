from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.update_organization_body import UpdateOrganizationBody
from ...models.update_organization_response_200 import UpdateOrganizationResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: UpdateOrganizationBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/organization",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> UpdateOrganizationResponse200 | None:
    if response.status_code == 200:
        response_200 = UpdateOrganizationResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[UpdateOrganizationResponse200]:
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
    body: UpdateOrganizationBody,
) -> Response[UpdateOrganizationResponse200]:
    """Update the organization profile. Partial: only the fields present are written, and the response is
    exactly what a subsequent GET returns.

    Args:
        body (UpdateOrganizationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateOrganizationResponse200]
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
    body: UpdateOrganizationBody,
) -> UpdateOrganizationResponse200 | None:
    """Update the organization profile. Partial: only the fields present are written, and the response is
    exactly what a subsequent GET returns.

    Args:
        body (UpdateOrganizationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateOrganizationResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: UpdateOrganizationBody,
) -> Response[UpdateOrganizationResponse200]:
    """Update the organization profile. Partial: only the fields present are written, and the response is
    exactly what a subsequent GET returns.

    Args:
        body (UpdateOrganizationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateOrganizationResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: UpdateOrganizationBody,
) -> UpdateOrganizationResponse200 | None:
    """Update the organization profile. Partial: only the fields present are written, and the response is
    exactly what a subsequent GET returns.

    Args:
        body (UpdateOrganizationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateOrganizationResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
