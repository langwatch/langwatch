from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_list_schemas_response_200 import ScimListSchemasResponse200
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/scim/v2/Schemas",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ScimListSchemasResponse200 | None:
    if response.status_code == 200:
        response_200 = ScimListSchemasResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ScimListSchemasResponse200]:
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
    client: AuthenticatedClient | Client,
) -> Response[ScimListSchemasResponse200]:
    """List the SCIM resource schemas

     The attribute definitions for the User and Group resources (RFC 7643 section 7), which an identity
    provider reads to build its attribute mapping. A LangWatch group is an access group: its membership
    drives role bindings, and it is not a team. Unauthenticated, like the rest of SCIM discovery.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimListSchemasResponse200]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> ScimListSchemasResponse200 | None:
    """List the SCIM resource schemas

     The attribute definitions for the User and Group resources (RFC 7643 section 7), which an identity
    provider reads to build its attribute mapping. A LangWatch group is an access group: its membership
    drives role bindings, and it is not a team. Unauthenticated, like the rest of SCIM discovery.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimListSchemasResponse200
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[ScimListSchemasResponse200]:
    """List the SCIM resource schemas

     The attribute definitions for the User and Group resources (RFC 7643 section 7), which an identity
    provider reads to build its attribute mapping. A LangWatch group is an access group: its membership
    drives role bindings, and it is not a team. Unauthenticated, like the rest of SCIM discovery.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimListSchemasResponse200]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> ScimListSchemasResponse200 | None:
    """List the SCIM resource schemas

     The attribute definitions for the User and Group resources (RFC 7643 section 7), which an identity
    provider reads to build its attribute mapping. A LangWatch group is an access group: its membership
    drives role bindings, and it is not a team. Unauthenticated, like the rest of SCIM discovery.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimListSchemasResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
