from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_replace_group_response_200 import ScimReplaceGroupResponse200
from ...models.scim_replace_group_response_400 import ScimReplaceGroupResponse400
from ...models.scim_replace_group_response_401 import ScimReplaceGroupResponse401
from ...models.scim_replace_group_response_403 import ScimReplaceGroupResponse403
from ...models.scim_replace_group_response_404 import ScimReplaceGroupResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/scim/v2/Groups/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ScimReplaceGroupResponse200
    | ScimReplaceGroupResponse400
    | ScimReplaceGroupResponse401
    | ScimReplaceGroupResponse403
    | ScimReplaceGroupResponse404
    | None
):
    if response.status_code == 200:
        response_200 = ScimReplaceGroupResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ScimReplaceGroupResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ScimReplaceGroupResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ScimReplaceGroupResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ScimReplaceGroupResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ScimReplaceGroupResponse200
    | ScimReplaceGroupResponse400
    | ScimReplaceGroupResponse401
    | ScimReplaceGroupResponse403
    | ScimReplaceGroupResponse404
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
    ScimReplaceGroupResponse200
    | ScimReplaceGroupResponse400
    | ScimReplaceGroupResponse401
    | ScimReplaceGroupResponse403
    | ScimReplaceGroupResponse404
]:
    """Replace a provisioned group

     Replaces the group's display name and its membership with the body. Membership is a whole-resource
    write: a member absent from `members` is removed from the group, and omitting `members` empties it.
    Role bindings granted to the group are untouched.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimReplaceGroupResponse200 | ScimReplaceGroupResponse400 | ScimReplaceGroupResponse401 | ScimReplaceGroupResponse403 | ScimReplaceGroupResponse404]
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
    ScimReplaceGroupResponse200
    | ScimReplaceGroupResponse400
    | ScimReplaceGroupResponse401
    | ScimReplaceGroupResponse403
    | ScimReplaceGroupResponse404
    | None
):
    """Replace a provisioned group

     Replaces the group's display name and its membership with the body. Membership is a whole-resource
    write: a member absent from `members` is removed from the group, and omitting `members` empties it.
    Role bindings granted to the group are untouched.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimReplaceGroupResponse200 | ScimReplaceGroupResponse400 | ScimReplaceGroupResponse401 | ScimReplaceGroupResponse403 | ScimReplaceGroupResponse404
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
    ScimReplaceGroupResponse200
    | ScimReplaceGroupResponse400
    | ScimReplaceGroupResponse401
    | ScimReplaceGroupResponse403
    | ScimReplaceGroupResponse404
]:
    """Replace a provisioned group

     Replaces the group's display name and its membership with the body. Membership is a whole-resource
    write: a member absent from `members` is removed from the group, and omitting `members` empties it.
    Role bindings granted to the group are untouched.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimReplaceGroupResponse200 | ScimReplaceGroupResponse400 | ScimReplaceGroupResponse401 | ScimReplaceGroupResponse403 | ScimReplaceGroupResponse404]
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
    ScimReplaceGroupResponse200
    | ScimReplaceGroupResponse400
    | ScimReplaceGroupResponse401
    | ScimReplaceGroupResponse403
    | ScimReplaceGroupResponse404
    | None
):
    """Replace a provisioned group

     Replaces the group's display name and its membership with the body. Membership is a whole-resource
    write: a member absent from `members` is removed from the group, and omitting `members` empties it.
    Role bindings granted to the group are untouched.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimReplaceGroupResponse200 | ScimReplaceGroupResponse400 | ScimReplaceGroupResponse401 | ScimReplaceGroupResponse403 | ScimReplaceGroupResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
