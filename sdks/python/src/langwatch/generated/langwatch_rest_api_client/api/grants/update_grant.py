from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.update_grant_body import UpdateGrantBody
from ...models.update_grant_response_200 import UpdateGrantResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    grant_id: str,
    *,
    body: UpdateGrantBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/grants/{grant_id}".format(
            grant_id=quote(str(grant_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> UpdateGrantResponse200 | None:
    if response.status_code == 200:
        response_200 = UpdateGrantResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[UpdateGrantResponse200]:
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
    grant_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateGrantBody,
) -> Response[UpdateGrantResponse200]:
    """Change a grant's role

     Change the role a grant confers. The principal and scope are the grant's identity and do not change.
    Lowering the organization's last administrator answers cannot_demote_last_admin. A grant never
    confers a permission the caller does not hold at that scope: 403 grant_exceeds_caller_permissions
    names the missing permissions.

    Args:
        grant_id (str):
        body (UpdateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateGrantResponse200]
    """

    kwargs = _get_kwargs(
        grant_id=grant_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    grant_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateGrantBody,
) -> UpdateGrantResponse200 | None:
    """Change a grant's role

     Change the role a grant confers. The principal and scope are the grant's identity and do not change.
    Lowering the organization's last administrator answers cannot_demote_last_admin. A grant never
    confers a permission the caller does not hold at that scope: 403 grant_exceeds_caller_permissions
    names the missing permissions.

    Args:
        grant_id (str):
        body (UpdateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateGrantResponse200
    """

    return sync_detailed(
        grant_id=grant_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    grant_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateGrantBody,
) -> Response[UpdateGrantResponse200]:
    """Change a grant's role

     Change the role a grant confers. The principal and scope are the grant's identity and do not change.
    Lowering the organization's last administrator answers cannot_demote_last_admin. A grant never
    confers a permission the caller does not hold at that scope: 403 grant_exceeds_caller_permissions
    names the missing permissions.

    Args:
        grant_id (str):
        body (UpdateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateGrantResponse200]
    """

    kwargs = _get_kwargs(
        grant_id=grant_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    grant_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateGrantBody,
) -> UpdateGrantResponse200 | None:
    """Change a grant's role

     Change the role a grant confers. The principal and scope are the grant's identity and do not change.
    Lowering the organization's last administrator answers cannot_demote_last_admin. A grant never
    confers a permission the caller does not hold at that scope: 403 grant_exceeds_caller_permissions
    names the missing permissions.

    Args:
        grant_id (str):
        body (UpdateGrantBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateGrantResponse200
    """

    return (
        await asyncio_detailed(
            grant_id=grant_id,
            client=client,
            body=body,
        )
    ).parsed
