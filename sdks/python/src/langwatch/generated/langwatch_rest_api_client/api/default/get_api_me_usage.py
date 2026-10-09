from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_me_usage_response_200 import GetApiMeUsageResponse200
from ...models.get_api_me_usage_response_400 import GetApiMeUsageResponse400
from ...models.get_api_me_usage_response_401 import GetApiMeUsageResponse401
from ...models.get_api_me_usage_response_422 import GetApiMeUsageResponse422
from ...models.get_api_me_usage_response_500 import GetApiMeUsageResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    window_start_ms: int | Unset = UNSET,
    window_end_ms: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["windowStartMs"] = window_start_ms

    params["windowEndMs"] = window_end_ms

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/me/usage",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiMeUsageResponse200
    | GetApiMeUsageResponse400
    | GetApiMeUsageResponse401
    | GetApiMeUsageResponse422
    | GetApiMeUsageResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiMeUsageResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiMeUsageResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiMeUsageResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiMeUsageResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiMeUsageResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiMeUsageResponse200
    | GetApiMeUsageResponse400
    | GetApiMeUsageResponse401
    | GetApiMeUsageResponse422
    | GetApiMeUsageResponse500
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
    *,
    client: AuthenticatedClient,
    window_start_ms: int | Unset = UNSET,
    window_end_ms: int | Unset = UNSET,
) -> Response[
    GetApiMeUsageResponse200
    | GetApiMeUsageResponse400
    | GetApiMeUsageResponse401
    | GetApiMeUsageResponse422
    | GetApiMeUsageResponse500
]:
    """Personal AI usage for the current month (or an explicit window): spend, billed spend, request +
    token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.

    Args:
        window_start_ms (int | Unset):
        window_end_ms (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiMeUsageResponse200 | GetApiMeUsageResponse400 | GetApiMeUsageResponse401 | GetApiMeUsageResponse422 | GetApiMeUsageResponse500]
    """

    kwargs = _get_kwargs(
        window_start_ms=window_start_ms,
        window_end_ms=window_end_ms,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    window_start_ms: int | Unset = UNSET,
    window_end_ms: int | Unset = UNSET,
) -> (
    GetApiMeUsageResponse200
    | GetApiMeUsageResponse400
    | GetApiMeUsageResponse401
    | GetApiMeUsageResponse422
    | GetApiMeUsageResponse500
    | None
):
    """Personal AI usage for the current month (or an explicit window): spend, billed spend, request +
    token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.

    Args:
        window_start_ms (int | Unset):
        window_end_ms (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiMeUsageResponse200 | GetApiMeUsageResponse400 | GetApiMeUsageResponse401 | GetApiMeUsageResponse422 | GetApiMeUsageResponse500
    """

    return sync_detailed(
        client=client,
        window_start_ms=window_start_ms,
        window_end_ms=window_end_ms,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    window_start_ms: int | Unset = UNSET,
    window_end_ms: int | Unset = UNSET,
) -> Response[
    GetApiMeUsageResponse200
    | GetApiMeUsageResponse400
    | GetApiMeUsageResponse401
    | GetApiMeUsageResponse422
    | GetApiMeUsageResponse500
]:
    """Personal AI usage for the current month (or an explicit window): spend, billed spend, request +
    token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.

    Args:
        window_start_ms (int | Unset):
        window_end_ms (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiMeUsageResponse200 | GetApiMeUsageResponse400 | GetApiMeUsageResponse401 | GetApiMeUsageResponse422 | GetApiMeUsageResponse500]
    """

    kwargs = _get_kwargs(
        window_start_ms=window_start_ms,
        window_end_ms=window_end_ms,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    window_start_ms: int | Unset = UNSET,
    window_end_ms: int | Unset = UNSET,
) -> (
    GetApiMeUsageResponse200
    | GetApiMeUsageResponse400
    | GetApiMeUsageResponse401
    | GetApiMeUsageResponse422
    | GetApiMeUsageResponse500
    | None
):
    """Personal AI usage for the current month (or an explicit window): spend, billed spend, request +
    token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.

    Args:
        window_start_ms (int | Unset):
        window_end_ms (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiMeUsageResponse200 | GetApiMeUsageResponse400 | GetApiMeUsageResponse401 | GetApiMeUsageResponse422 | GetApiMeUsageResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            window_start_ms=window_start_ms,
            window_end_ms=window_end_ms,
        )
    ).parsed
