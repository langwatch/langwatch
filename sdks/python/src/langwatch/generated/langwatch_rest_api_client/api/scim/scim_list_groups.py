from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_list_groups_response_200 import ScimListGroupsResponse200
from ...models.scim_list_groups_response_401 import ScimListGroupsResponse401
from ...models.scim_list_groups_response_403 import ScimListGroupsResponse403
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
    excluded_attributes: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["filter"] = filter_

    params["startIndex"] = start_index

    params["count"] = count

    params["excludedAttributes"] = excluded_attributes

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/scim/v2/Groups",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403 | None:
    if response.status_code == 200:
        response_200 = ScimListGroupsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ScimListGroupsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ScimListGroupsResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403]:
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
    excluded_attributes: str | Unset = UNSET,
) -> Response[ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403]:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403]
    """

    kwargs = _get_kwargs(
        filter_=filter_,
        start_index=start_index,
        count=count,
        excluded_attributes=excluded_attributes,
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
    excluded_attributes: str | Unset = UNSET,
) -> ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403 | None:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403
    """

    return sync_detailed(
        client=client,
        filter_=filter_,
        start_index=start_index,
        count=count,
        excluded_attributes=excluded_attributes,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
    excluded_attributes: str | Unset = UNSET,
) -> Response[ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403]:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403]
    """

    kwargs = _get_kwargs(
        filter_=filter_,
        start_index=start_index,
        count=count,
        excluded_attributes=excluded_attributes,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
    excluded_attributes: str | Unset = UNSET,
) -> ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403 | None:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ScimListGroupsResponse200 | ScimListGroupsResponse401 | ScimListGroupsResponse403
    """

    return (
        await asyncio_detailed(
            client=client,
            filter_=filter_,
            start_index=start_index,
            count=count,
            excluded_attributes=excluded_attributes,
        )
    ).parsed
