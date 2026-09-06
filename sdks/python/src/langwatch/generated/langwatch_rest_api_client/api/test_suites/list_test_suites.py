from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_test_suites_response_200_item import ListTestSuitesResponse200Item
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    include_archived: str | Unset = "false",
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["includeArchived"] = include_archived

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/test-suites",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> list[ListTestSuitesResponse200Item] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = ListTestSuitesResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[list[ListTestSuitesResponse200Item]]:
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
    include_archived: str | Unset = "false",
) -> Response[list[ListTestSuitesResponse200Item]]:
    """List the project's test suites. Archived suites are left out unless includeArchived is set. Run
    plans are not test suites and are listed by the run plans family.

    Args:
        include_archived (str | Unset):  Default: 'false'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[list[ListTestSuitesResponse200Item]]
    """

    kwargs = _get_kwargs(
        include_archived=include_archived,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    include_archived: str | Unset = "false",
) -> list[ListTestSuitesResponse200Item] | None:
    """List the project's test suites. Archived suites are left out unless includeArchived is set. Run
    plans are not test suites and are listed by the run plans family.

    Args:
        include_archived (str | Unset):  Default: 'false'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        list[ListTestSuitesResponse200Item]
    """

    return sync_detailed(
        client=client,
        include_archived=include_archived,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    include_archived: str | Unset = "false",
) -> Response[list[ListTestSuitesResponse200Item]]:
    """List the project's test suites. Archived suites are left out unless includeArchived is set. Run
    plans are not test suites and are listed by the run plans family.

    Args:
        include_archived (str | Unset):  Default: 'false'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[list[ListTestSuitesResponse200Item]]
    """

    kwargs = _get_kwargs(
        include_archived=include_archived,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    include_archived: str | Unset = "false",
) -> list[ListTestSuitesResponse200Item] | None:
    """List the project's test suites. Archived suites are left out unless includeArchived is set. Run
    plans are not test suites and are listed by the run plans family.

    Args:
        include_archived (str | Unset):  Default: 'false'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        list[ListTestSuitesResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
            include_archived=include_archived,
        )
    ).parsed
