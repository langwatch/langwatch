from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_list_groups_response_200 import ScimListGroupsResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = UNSET,
    count: int | Unset = UNSET,
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
) -> Any | ScimListGroupsResponse200 | None:
    if response.status_code == 200:
        response_200 = ScimListGroupsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ScimListGroupsResponse200]:
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
    start_index: int | Unset = UNSET,
    count: int | Unset = UNSET,
    excluded_attributes: str | Unset = UNSET,
) -> Response[Any | ScimListGroupsResponse200]:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):
        count (int | Unset):
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimListGroupsResponse200]
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
    start_index: int | Unset = UNSET,
    count: int | Unset = UNSET,
    excluded_attributes: str | Unset = UNSET,
) -> Any | ScimListGroupsResponse200 | None:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):
        count (int | Unset):
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimListGroupsResponse200
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
    start_index: int | Unset = UNSET,
    count: int | Unset = UNSET,
    excluded_attributes: str | Unset = UNSET,
) -> Response[Any | ScimListGroupsResponse200]:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):
        count (int | Unset):
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimListGroupsResponse200]
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
    start_index: int | Unset = UNSET,
    count: int | Unset = UNSET,
    excluded_attributes: str | Unset = UNSET,
) -> Any | ScimListGroupsResponse200 | None:
    r"""List provisioned groups

     The organization's SCIM-provisioned access groups. Groups created in LangWatch itself are not
    listed: the directory sees what it provisioned, and nothing else. One filter expression is
    understood, `displayName eq \"Engineering\"`, matched without regard to case.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):
        count (int | Unset):
        excluded_attributes (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimListGroupsResponse200
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
