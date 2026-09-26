from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_create_user_body import ScimCreateUserBody
from ...models.scim_create_user_response_201 import ScimCreateUserResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: ScimCreateUserBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/scim/v2/Users",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/scim+json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ScimCreateUserResponse201 | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 201:
        response_201 = ScimCreateUserResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 409:
        response_409 = cast(Any, None)
        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ScimCreateUserResponse201]:
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
    body: ScimCreateUserBody,
) -> Response[Any | ScimCreateUserResponse201]:
    """Provision a user

     Adds a member to the organization, creating the LangWatch account when the email is new. Someone who
    already has an account is added and reactivated rather than refused, which is what lets a directory
    sync be re-run without special-casing the people it already knows. New members join with the MEMBER
    role at organization scope. `costCenter` on the enterprise user extension assigns their department,
    creating that department on first use.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimCreateUserResponse201]
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
    body: ScimCreateUserBody,
) -> Any | ScimCreateUserResponse201 | None:
    """Provision a user

     Adds a member to the organization, creating the LangWatch account when the email is new. Someone who
    already has an account is added and reactivated rather than refused, which is what lets a directory
    sync be re-run without special-casing the people it already knows. New members join with the MEMBER
    role at organization scope. `costCenter` on the enterprise user extension assigns their department,
    creating that department on first use.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimCreateUserResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ScimCreateUserBody,
) -> Response[Any | ScimCreateUserResponse201]:
    """Provision a user

     Adds a member to the organization, creating the LangWatch account when the email is new. Someone who
    already has an account is added and reactivated rather than refused, which is what lets a directory
    sync be re-run without special-casing the people it already knows. New members join with the MEMBER
    role at organization scope. `costCenter` on the enterprise user extension assigns their department,
    creating that department on first use.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimCreateUserResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ScimCreateUserBody,
) -> Any | ScimCreateUserResponse201 | None:
    """Provision a user

     Adds a member to the organization, creating the LangWatch account when the email is new. Someone who
    already has an account is added and reactivated rather than refused, which is what lets a directory
    sync be re-run without special-casing the people it already knows. New members join with the MEMBER
    role at organization scope. `costCenter` on the enterprise user extension assigns their department,
    creating that department on first use.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimCreateUserResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
