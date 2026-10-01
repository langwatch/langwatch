from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_patch_group_body import ScimPatchGroupBody
from ...models.scim_patch_group_response_200 import ScimPatchGroupResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: ScimPatchGroupBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/scim/v2/Groups/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/scim+json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ScimPatchGroupResponse200 | None:
    if response.status_code == 200:
        response_200 = ScimPatchGroupResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ScimPatchGroupResponse200]:
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
    body: ScimPatchGroupBody,
) -> Response[Any | ScimPatchGroupResponse200]:
    """Update a provisioned group

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `add` of members, `remove` of
    members (named by a value filter on the path, as Entra ID writes it, or in the operation value),
    `replace` of `displayName`, and `replace` of the whole member list. `replace`, `add` and `remove`
    are the only operation names understood, read without regard to case, so the capitalized `Add` /
    `Remove` that Entra ID writes are accepted; any other name, or a missing or non-string one, is
    rejected with a 400. An `add` or a `remove` aimed at anything other than members is accepted and
    changes nothing. A `replace` that is not a `displayName` rename is treated as a replacement of the
    whole member list, so one that carries no members empties the group.

    Args:
        id (str):
        body (ScimPatchGroupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimPatchGroupResponse200]
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
    body: ScimPatchGroupBody,
) -> Any | ScimPatchGroupResponse200 | None:
    """Update a provisioned group

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `add` of members, `remove` of
    members (named by a value filter on the path, as Entra ID writes it, or in the operation value),
    `replace` of `displayName`, and `replace` of the whole member list. `replace`, `add` and `remove`
    are the only operation names understood, read without regard to case, so the capitalized `Add` /
    `Remove` that Entra ID writes are accepted; any other name, or a missing or non-string one, is
    rejected with a 400. An `add` or a `remove` aimed at anything other than members is accepted and
    changes nothing. A `replace` that is not a `displayName` rename is treated as a replacement of the
    whole member list, so one that carries no members empties the group.

    Args:
        id (str):
        body (ScimPatchGroupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimPatchGroupResponse200
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
    body: ScimPatchGroupBody,
) -> Response[Any | ScimPatchGroupResponse200]:
    """Update a provisioned group

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `add` of members, `remove` of
    members (named by a value filter on the path, as Entra ID writes it, or in the operation value),
    `replace` of `displayName`, and `replace` of the whole member list. `replace`, `add` and `remove`
    are the only operation names understood, read without regard to case, so the capitalized `Add` /
    `Remove` that Entra ID writes are accepted; any other name, or a missing or non-string one, is
    rejected with a 400. An `add` or a `remove` aimed at anything other than members is accepted and
    changes nothing. A `replace` that is not a `displayName` rename is treated as a replacement of the
    whole member list, so one that carries no members empties the group.

    Args:
        id (str):
        body (ScimPatchGroupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimPatchGroupResponse200]
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
    body: ScimPatchGroupBody,
) -> Any | ScimPatchGroupResponse200 | None:
    """Update a provisioned group

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `add` of members, `remove` of
    members (named by a value filter on the path, as Entra ID writes it, or in the operation value),
    `replace` of `displayName`, and `replace` of the whole member list. `replace`, `add` and `remove`
    are the only operation names understood, read without regard to case, so the capitalized `Add` /
    `Remove` that Entra ID writes are accepted; any other name, or a missing or non-string one, is
    rejected with a 400. An `add` or a `remove` aimed at anything other than members is accepted and
    changes nothing. A `replace` that is not a `displayName` rename is treated as a replacement of the
    whole member list, so one that carries no members empties the group.

    Args:
        id (str):
        body (ScimPatchGroupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimPatchGroupResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
