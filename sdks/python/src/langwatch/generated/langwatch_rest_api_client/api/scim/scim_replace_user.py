from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_replace_user_response_200 import ScimReplaceUserResponse200
from ...models.scim_replace_user_response_400 import ScimReplaceUserResponse400
from ...models.scim_replace_user_response_401 import ScimReplaceUserResponse401
from ...models.scim_replace_user_response_403 import ScimReplaceUserResponse403
from ...models.scim_replace_user_response_404 import ScimReplaceUserResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/scim/v2/Users/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ScimReplaceUserResponse200
    | ScimReplaceUserResponse400
    | ScimReplaceUserResponse401
    | ScimReplaceUserResponse403
    | ScimReplaceUserResponse404
    | None
):
    if response.status_code == 200:
        response_200 = ScimReplaceUserResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ScimReplaceUserResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ScimReplaceUserResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ScimReplaceUserResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ScimReplaceUserResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ScimReplaceUserResponse200
    | ScimReplaceUserResponse400
    | ScimReplaceUserResponse401
    | ScimReplaceUserResponse403
    | ScimReplaceUserResponse404
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
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    ScimReplaceUserResponse200
    | ScimReplaceUserResponse400
    | ScimReplaceUserResponse401
    | ScimReplaceUserResponse403
    | ScimReplaceUserResponse404
]:
    """Replace a provisioned user

     Replaces the member's attributes with the body. It is a whole-resource write, so an attribute the
    identity provider leaves out is reset rather than kept: omitting `active` reactivates the member.
    Send PATCH instead to change one attribute.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimReplaceUserResponse200 | ScimReplaceUserResponse400 | ScimReplaceUserResponse401 | ScimReplaceUserResponse403 | ScimReplaceUserResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    ScimReplaceUserResponse200
    | ScimReplaceUserResponse400
    | ScimReplaceUserResponse401
    | ScimReplaceUserResponse403
    | ScimReplaceUserResponse404
    | None
):
    """Replace a provisioned user

     Replaces the member's attributes with the body. It is a whole-resource write, so an attribute the
    identity provider leaves out is reset rather than kept: omitting `active` reactivates the member.
    Send PATCH instead to change one attribute.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimReplaceUserResponse200 | ScimReplaceUserResponse400 | ScimReplaceUserResponse401 | ScimReplaceUserResponse403 | ScimReplaceUserResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    ScimReplaceUserResponse200
    | ScimReplaceUserResponse400
    | ScimReplaceUserResponse401
    | ScimReplaceUserResponse403
    | ScimReplaceUserResponse404
]:
    """Replace a provisioned user

     Replaces the member's attributes with the body. It is a whole-resource write, so an attribute the
    identity provider leaves out is reset rather than kept: omitting `active` reactivates the member.
    Send PATCH instead to change one attribute.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimReplaceUserResponse200 | ScimReplaceUserResponse400 | ScimReplaceUserResponse401 | ScimReplaceUserResponse403 | ScimReplaceUserResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    ScimReplaceUserResponse200
    | ScimReplaceUserResponse400
    | ScimReplaceUserResponse401
    | ScimReplaceUserResponse403
    | ScimReplaceUserResponse404
    | None
):
    """Replace a provisioned user

     Replaces the member's attributes with the body. It is a whole-resource write, so an attribute the
    identity provider leaves out is reset rather than kept: omitting `active` reactivates the member.
    Send PATCH instead to change one attribute.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimReplaceUserResponse200 | ScimReplaceUserResponse400 | ScimReplaceUserResponse401 | ScimReplaceUserResponse403 | ScimReplaceUserResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
