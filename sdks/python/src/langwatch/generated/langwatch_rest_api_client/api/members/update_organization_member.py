from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.update_organization_member_body import UpdateOrganizationMemberBody
from ...models.update_organization_member_response_200 import UpdateOrganizationMemberResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    user_id: str,
    *,
    body: UpdateOrganizationMemberBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/organization/members/{user_id}".format(
            user_id=quote(str(user_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> UpdateOrganizationMemberResponse200 | None:
    if response.status_code == 200:
        response_200 = UpdateOrganizationMemberResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[UpdateOrganizationMemberResponse200]:
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
    user_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateOrganizationMemberBody | Unset = UNSET,
) -> Response[UpdateOrganizationMemberResponse200]:
    """Change a member's organization role, or disable / re-enable their membership. Send exactly one of
    role or disabled. Re-enabling consumes a seat, so it is checked against the plan.

    Args:
        user_id (str):
        body (UpdateOrganizationMemberBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateOrganizationMemberResponse200]
    """

    kwargs = _get_kwargs(
        user_id=user_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    user_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateOrganizationMemberBody | Unset = UNSET,
) -> UpdateOrganizationMemberResponse200 | None:
    """Change a member's organization role, or disable / re-enable their membership. Send exactly one of
    role or disabled. Re-enabling consumes a seat, so it is checked against the plan.

    Args:
        user_id (str):
        body (UpdateOrganizationMemberBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateOrganizationMemberResponse200
    """

    return sync_detailed(
        user_id=user_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    user_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateOrganizationMemberBody | Unset = UNSET,
) -> Response[UpdateOrganizationMemberResponse200]:
    """Change a member's organization role, or disable / re-enable their membership. Send exactly one of
    role or disabled. Re-enabling consumes a seat, so it is checked against the plan.

    Args:
        user_id (str):
        body (UpdateOrganizationMemberBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateOrganizationMemberResponse200]
    """

    kwargs = _get_kwargs(
        user_id=user_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    user_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateOrganizationMemberBody | Unset = UNSET,
) -> UpdateOrganizationMemberResponse200 | None:
    """Change a member's organization role, or disable / re-enable their membership. Send exactly one of
    role or disabled. Re-enabling consumes a seat, so it is checked against the plan.

    Args:
        user_id (str):
        body (UpdateOrganizationMemberBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateOrganizationMemberResponse200
    """

    return (
        await asyncio_detailed(
            user_id=user_id,
            client=client,
            body=body,
        )
    ).parsed
