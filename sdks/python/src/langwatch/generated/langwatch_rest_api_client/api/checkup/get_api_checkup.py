from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_checkup_response_200 import GetApiCheckupResponse200
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/checkup",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | GetApiCheckupResponse200 | None:
    if response.status_code == 200:
        response_200 = GetApiCheckupResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | GetApiCheckupResponse200]:
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
) -> Response[Any | GetApiCheckupResponse200]:
    """Run the free checks of a self-hosted install

     The checkup `langwatch doctor` and the Settings > Checkup page show: one row per check with a pass,
    fail or not checked verdict. Checks that open a connection or spend money are reported as not
    checked here and run through `POST /api/checkup/run`. The response also carries the usage report
    this install would send next. Answers 404 on LangWatch Cloud.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiCheckupResponse200]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> Any | GetApiCheckupResponse200 | None:
    """Run the free checks of a self-hosted install

     The checkup `langwatch doctor` and the Settings > Checkup page show: one row per check with a pass,
    fail or not checked verdict. Checks that open a connection or spend money are reported as not
    checked here and run through `POST /api/checkup/run`. The response also carries the usage report
    this install would send next. Answers 404 on LangWatch Cloud.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiCheckupResponse200
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[Any | GetApiCheckupResponse200]:
    """Run the free checks of a self-hosted install

     The checkup `langwatch doctor` and the Settings > Checkup page show: one row per check with a pass,
    fail or not checked verdict. Checks that open a connection or spend money are reported as not
    checked here and run through `POST /api/checkup/run`. The response also carries the usage report
    this install would send next. Answers 404 on LangWatch Cloud.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiCheckupResponse200]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> Any | GetApiCheckupResponse200 | None:
    """Run the free checks of a self-hosted install

     The checkup `langwatch doctor` and the Settings > Checkup page show: one row per check with a pass,
    fail or not checked verdict. Checks that open a connection or spend money are reported as not
    checked here and run through `POST /api/checkup/run`. The response also carries the usage report
    this install would send next. Answers 404 on LangWatch Cloud.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiCheckupResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
