from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_patch_user_body import ScimPatchUserBody
from ...models.scim_patch_user_response_200 import ScimPatchUserResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: ScimPatchUserBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/scim/v2/Users/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/scim+json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ScimPatchUserResponse200 | None:
    if response.status_code == 200:
        response_200 = ScimPatchUserResponse200.from_dict(response.json())

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
) -> Response[Any | ScimPatchUserResponse200]:
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
    body: ScimPatchUserBody,
) -> Response[Any | ScimPatchUserResponse200]:
    """Update a provisioned user

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `replace` of `active`
    (deactivating or reactivating the account), of `userName`, and of `name.givenName` /
    `name.familyName`, written either as an operation path or as keys inside a value object; and `add`,
    `replace` or `remove` of the enterprise `costCenter`, which reassigns the member's department.
    `replace`, `add` and `remove` are the only operation names understood, read without regard to case,
    so the capitalized `Replace` that Entra ID writes is accepted; any other name, or a missing or non-
    string one, is rejected with a 400. An understood operation aimed at anything not listed above is
    accepted and changes nothing.

    Args:
        id (str):
        body (ScimPatchUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimPatchUserResponse200]
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
    body: ScimPatchUserBody,
) -> Any | ScimPatchUserResponse200 | None:
    """Update a provisioned user

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `replace` of `active`
    (deactivating or reactivating the account), of `userName`, and of `name.givenName` /
    `name.familyName`, written either as an operation path or as keys inside a value object; and `add`,
    `replace` or `remove` of the enterprise `costCenter`, which reassigns the member's department.
    `replace`, `add` and `remove` are the only operation names understood, read without regard to case,
    so the capitalized `Replace` that Entra ID writes is accepted; any other name, or a missing or non-
    string one, is rejected with a 400. An understood operation aimed at anything not listed above is
    accepted and changes nothing.

    Args:
        id (str):
        body (ScimPatchUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimPatchUserResponse200
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
    body: ScimPatchUserBody,
) -> Response[Any | ScimPatchUserResponse200]:
    """Update a provisioned user

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `replace` of `active`
    (deactivating or reactivating the account), of `userName`, and of `name.givenName` /
    `name.familyName`, written either as an operation path or as keys inside a value object; and `add`,
    `replace` or `remove` of the enterprise `costCenter`, which reassigns the member's department.
    `replace`, `add` and `remove` are the only operation names understood, read without regard to case,
    so the capitalized `Replace` that Entra ID writes is accepted; any other name, or a missing or non-
    string one, is rejected with a 400. An understood operation aimed at anything not listed above is
    accepted and changes nothing.

    Args:
        id (str):
        body (ScimPatchUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimPatchUserResponse200]
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
    body: ScimPatchUserBody,
) -> Any | ScimPatchUserResponse200 | None:
    """Update a provisioned user

     Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `replace` of `active`
    (deactivating or reactivating the account), of `userName`, and of `name.givenName` /
    `name.familyName`, written either as an operation path or as keys inside a value object; and `add`,
    `replace` or `remove` of the enterprise `costCenter`, which reassigns the member's department.
    `replace`, `add` and `remove` are the only operation names understood, read without regard to case,
    so the capitalized `Replace` that Entra ID writes is accepted; any other name, or a missing or non-
    string one, is rejected with a 400. An understood operation aimed at anything not listed above is
    accepted and changes nothing.

    Args:
        id (str):
        body (ScimPatchUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimPatchUserResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
