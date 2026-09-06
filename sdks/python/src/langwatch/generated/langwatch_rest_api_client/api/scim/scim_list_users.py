from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_list_users_response_200 import ScimListUsersResponse200
from ...models.scim_list_users_response_401 import ScimListUsersResponse401
from ...models.scim_list_users_response_403 import ScimListUsersResponse403
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["filter"] = filter_

    params["startIndex"] = start_index

    params["count"] = count

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/scim/v2/Users",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403 | None:
    if response.status_code == 200:
        response_200 = ScimListUsersResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ScimListUsersResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ScimListUsersResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403]:
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
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> Response[ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403]:
    r"""List provisioned users

     The members of the organization the token belongs to, as SCIM users. One filter expression is
    understood, `userName eq \"someone@example.com\"`, matched against the member's email without regard
    to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403]
    """

    kwargs = _get_kwargs(
        filter_=filter_,
        start_index=start_index,
        count=count,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403 | None:
    r"""List provisioned users

     The members of the organization the token belongs to, as SCIM users. One filter expression is
    understood, `userName eq \"someone@example.com\"`, matched against the member's email without regard
    to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403
    """

    return sync_detailed(
        client=client,
        filter_=filter_,
        start_index=start_index,
        count=count,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> Response[ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403]:
    r"""List provisioned users

     The members of the organization the token belongs to, as SCIM users. One filter expression is
    understood, `userName eq \"someone@example.com\"`, matched against the member's email without regard
    to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403]
    """

    kwargs = _get_kwargs(
        filter_=filter_,
        start_index=start_index,
        count=count,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403 | None:
    r"""List provisioned users

     The members of the organization the token belongs to, as SCIM users. One filter expression is
    understood, `userName eq \"someone@example.com\"`, matched against the member's email without regard
    to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimListUsersResponse200 | ScimListUsersResponse401 | ScimListUsersResponse403
    """

    return (
        await asyncio_detailed(
            client=client,
            filter_=filter_,
            start_index=start_index,
            count=count,
        )
    ).parsed
