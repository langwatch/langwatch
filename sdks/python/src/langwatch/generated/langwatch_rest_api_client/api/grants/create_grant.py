from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_grant_body import CreateGrantBody
from ...models.create_grant_response_201 import CreateGrantResponse201
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: CreateGrantBody,
    idempotency_key: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/grants",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> CreateGrantResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateGrantResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CreateGrantResponse201]:
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
    body: CreateGrantBody,
    idempotency_key: str | Unset = UNSET,
) -> Response[CreateGrantResponse201]:
    """Grant a role

     Grant a role to a user, group or API key on the organization, a team or a project. `roleId` is
    `admin`, `member`, `viewer` or a custom role's id. Grants are never unique: each create is a new
    grant with its own id, up to the organization's limit (409 grant_limit_reached). Pass `expiresAt` to
    time-box the access. Send `Idempotency-Key` to make a retry safe. A grant never confers a permission
    the caller does not hold at that scope: 403 grant_exceeds_caller_permissions names the missing
    permissions.

    Args:
        idempotency_key (str | Unset):
        body (CreateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateGrantResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: CreateGrantBody,
    idempotency_key: str | Unset = UNSET,
) -> CreateGrantResponse201 | None:
    """Grant a role

     Grant a role to a user, group or API key on the organization, a team or a project. `roleId` is
    `admin`, `member`, `viewer` or a custom role's id. Grants are never unique: each create is a new
    grant with its own id, up to the organization's limit (409 grant_limit_reached). Pass `expiresAt` to
    time-box the access. Send `Idempotency-Key` to make a retry safe. A grant never confers a permission
    the caller does not hold at that scope: 403 grant_exceeds_caller_permissions names the missing
    permissions.

    Args:
        idempotency_key (str | Unset):
        body (CreateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateGrantResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateGrantBody,
    idempotency_key: str | Unset = UNSET,
) -> Response[CreateGrantResponse201]:
    """Grant a role

     Grant a role to a user, group or API key on the organization, a team or a project. `roleId` is
    `admin`, `member`, `viewer` or a custom role's id. Grants are never unique: each create is a new
    grant with its own id, up to the organization's limit (409 grant_limit_reached). Pass `expiresAt` to
    time-box the access. Send `Idempotency-Key` to make a retry safe. A grant never confers a permission
    the caller does not hold at that scope: 403 grant_exceeds_caller_permissions names the missing
    permissions.

    Args:
        idempotency_key (str | Unset):
        body (CreateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateGrantResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateGrantBody,
    idempotency_key: str | Unset = UNSET,
) -> CreateGrantResponse201 | None:
    """Grant a role

     Grant a role to a user, group or API key on the organization, a team or a project. `roleId` is
    `admin`, `member`, `viewer` or a custom role's id. Grants are never unique: each create is a new
    grant with its own id, up to the organization's limit (409 grant_limit_reached). Pass `expiresAt` to
    time-box the access. Send `Idempotency-Key` to make a retry safe. A grant never confers a permission
    the caller does not hold at that scope: 403 grant_exceeds_caller_permissions names the missing
    permissions.

    Args:
        idempotency_key (str | Unset):
        body (CreateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateGrantResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
