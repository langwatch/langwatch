from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.read_old_lambdas_cleanup_response_200 import ReadOldLambdasCleanupResponse200
from ...models.read_old_lambdas_cleanup_response_500 import ReadOldLambdasCleanupResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/cron/old_lambdas_cleanup",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500 | None:
    if response.status_code == 200:
        response_200 = ReadOldLambdasCleanupResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 500:
        response_500 = ReadOldLambdasCleanupResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500]:
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
) -> Response[ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500]:
    """The same sweep, for a scheduler that issues it as a GET

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500 | None:
    """The same sweep, for a scheduler that issues it as a GET

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500]:
    """The same sweep, for a scheduler that issues it as a GET

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500 | None:
    """The same sweep, for a scheduler that issues it as a GET

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadOldLambdasCleanupResponse200 | ReadOldLambdasCleanupResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
