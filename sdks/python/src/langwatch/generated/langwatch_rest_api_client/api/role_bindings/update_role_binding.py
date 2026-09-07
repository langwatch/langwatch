from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.update_role_binding_body import UpdateRoleBindingBody
from ...models.update_role_binding_response_200 import UpdateRoleBindingResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: UpdateRoleBindingBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/role-bindings/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> UpdateRoleBindingResponse200 | None:
    if response.status_code == 200:
        response_200 = UpdateRoleBindingResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[UpdateRoleBindingResponse200]:
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
    id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRoleBindingBody,
) -> Response[UpdateRoleBindingResponse200]:
    """Change a binding's role (and custom role). The principal and scope are the binding's identity and do
    not change; create a new binding instead.

    Args:
        id (str):
        body (UpdateRoleBindingBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateRoleBindingResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRoleBindingBody,
) -> UpdateRoleBindingResponse200 | None:
    """Change a binding's role (and custom role). The principal and scope are the binding's identity and do
    not change; create a new binding instead.

    Args:
        id (str):
        body (UpdateRoleBindingBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateRoleBindingResponse200
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRoleBindingBody,
) -> Response[UpdateRoleBindingResponse200]:
    """Change a binding's role (and custom role). The principal and scope are the binding's identity and do
    not change; create a new binding instead.

    Args:
        id (str):
        body (UpdateRoleBindingBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[UpdateRoleBindingResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateRoleBindingBody,
) -> UpdateRoleBindingResponse200 | None:
    """Change a binding's role (and custom role). The principal and scope are the binding's identity and do
    not change; create a new binding instead.

    Args:
        id (str):
        body (UpdateRoleBindingBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        UpdateRoleBindingResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
