from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_grant_response_200 import GetGrantResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    grant_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/grants/{grant_id}".format(
            grant_id=quote(str(grant_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> GetGrantResponse200 | None:
    if response.status_code == 200:
        response_200 = GetGrantResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[GetGrantResponse200]:
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
) -> Response[GetGrantResponse200]:
    """Get a grant

     Read one grant. An id outside the caller's organization answers 404 grant_not_found.

    Args:
        grant_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetGrantResponse200]
    """

    kwargs = _get_kwargs(
        grant_id=grant_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    grant_id: str,
    *,
    client: AuthenticatedClient,
) -> GetGrantResponse200 | None:
    """Get a grant

     Read one grant. An id outside the caller's organization answers 404 grant_not_found.

    Args:
        grant_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetGrantResponse200
    """

    return sync_detailed(
        grant_id=grant_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    grant_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[GetGrantResponse200]:
    """Get a grant

     Read one grant. An id outside the caller's organization answers 404 grant_not_found.

    Args:
        grant_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetGrantResponse200]
    """

    kwargs = _get_kwargs(
        grant_id=grant_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    grant_id: str,
    *,
    client: AuthenticatedClient,
) -> GetGrantResponse200 | None:
    """Get a grant

     Read one grant. An id outside the caller's organization answers 404 grant_not_found.

    Args:
        grant_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetGrantResponse200
    """

    return (
        await asyncio_detailed(
            grant_id=grant_id,
            client=client,
        )
    ).parsed
