from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.read_cli_budget_status_response_200 import ReadCliBudgetStatusResponse200
from ...models.read_cli_budget_status_response_400 import ReadCliBudgetStatusResponse400
from ...models.read_cli_budget_status_response_401 import ReadCliBudgetStatusResponse401
from ...models.read_cli_budget_status_response_402 import ReadCliBudgetStatusResponse402
from ...models.read_cli_budget_status_response_403 import ReadCliBudgetStatusResponse403
from ...models.read_cli_budget_status_response_404 import ReadCliBudgetStatusResponse404
from ...models.read_cli_budget_status_response_409 import ReadCliBudgetStatusResponse409
from ...models.read_cli_budget_status_response_412 import ReadCliBudgetStatusResponse412
from ...models.read_cli_budget_status_response_500 import ReadCliBudgetStatusResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/cli/budget/status",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ReadCliBudgetStatusResponse200
    | ReadCliBudgetStatusResponse400
    | ReadCliBudgetStatusResponse401
    | ReadCliBudgetStatusResponse402
    | ReadCliBudgetStatusResponse403
    | ReadCliBudgetStatusResponse404
    | ReadCliBudgetStatusResponse409
    | ReadCliBudgetStatusResponse412
    | ReadCliBudgetStatusResponse500
    | None
):
    if response.status_code == 200:
        response_200 = ReadCliBudgetStatusResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ReadCliBudgetStatusResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ReadCliBudgetStatusResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ReadCliBudgetStatusResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 403:
        response_403 = ReadCliBudgetStatusResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ReadCliBudgetStatusResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ReadCliBudgetStatusResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 412:
        response_412 = ReadCliBudgetStatusResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = ReadCliBudgetStatusResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ReadCliBudgetStatusResponse200
    | ReadCliBudgetStatusResponse400
    | ReadCliBudgetStatusResponse401
    | ReadCliBudgetStatusResponse402
    | ReadCliBudgetStatusResponse403
    | ReadCliBudgetStatusResponse404
    | ReadCliBudgetStatusResponse409
    | ReadCliBudgetStatusResponse412
    | ReadCliBudgetStatusResponse500
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
) -> Response[
    ReadCliBudgetStatusResponse200
    | ReadCliBudgetStatusResponse400
    | ReadCliBudgetStatusResponse401
    | ReadCliBudgetStatusResponse402
    | ReadCliBudgetStatusResponse403
    | ReadCliBudgetStatusResponse404
    | ReadCliBudgetStatusResponse409
    | ReadCliBudgetStatusResponse412
    | ReadCliBudgetStatusResponse500
]:
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadCliBudgetStatusResponse200 | ReadCliBudgetStatusResponse400 | ReadCliBudgetStatusResponse401 | ReadCliBudgetStatusResponse402 | ReadCliBudgetStatusResponse403 | ReadCliBudgetStatusResponse404 | ReadCliBudgetStatusResponse409 | ReadCliBudgetStatusResponse412 | ReadCliBudgetStatusResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    ReadCliBudgetStatusResponse200
    | ReadCliBudgetStatusResponse400
    | ReadCliBudgetStatusResponse401
    | ReadCliBudgetStatusResponse402
    | ReadCliBudgetStatusResponse403
    | ReadCliBudgetStatusResponse404
    | ReadCliBudgetStatusResponse409
    | ReadCliBudgetStatusResponse412
    | ReadCliBudgetStatusResponse500
    | None
):
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadCliBudgetStatusResponse200 | ReadCliBudgetStatusResponse400 | ReadCliBudgetStatusResponse401 | ReadCliBudgetStatusResponse402 | ReadCliBudgetStatusResponse403 | ReadCliBudgetStatusResponse404 | ReadCliBudgetStatusResponse409 | ReadCliBudgetStatusResponse412 | ReadCliBudgetStatusResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    ReadCliBudgetStatusResponse200
    | ReadCliBudgetStatusResponse400
    | ReadCliBudgetStatusResponse401
    | ReadCliBudgetStatusResponse402
    | ReadCliBudgetStatusResponse403
    | ReadCliBudgetStatusResponse404
    | ReadCliBudgetStatusResponse409
    | ReadCliBudgetStatusResponse412
    | ReadCliBudgetStatusResponse500
]:
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadCliBudgetStatusResponse200 | ReadCliBudgetStatusResponse400 | ReadCliBudgetStatusResponse401 | ReadCliBudgetStatusResponse402 | ReadCliBudgetStatusResponse403 | ReadCliBudgetStatusResponse404 | ReadCliBudgetStatusResponse409 | ReadCliBudgetStatusResponse412 | ReadCliBudgetStatusResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    ReadCliBudgetStatusResponse200
    | ReadCliBudgetStatusResponse400
    | ReadCliBudgetStatusResponse401
    | ReadCliBudgetStatusResponse402
    | ReadCliBudgetStatusResponse403
    | ReadCliBudgetStatusResponse404
    | ReadCliBudgetStatusResponse409
    | ReadCliBudgetStatusResponse412
    | ReadCliBudgetStatusResponse500
    | None
):
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadCliBudgetStatusResponse200 | ReadCliBudgetStatusResponse400 | ReadCliBudgetStatusResponse401 | ReadCliBudgetStatusResponse402 | ReadCliBudgetStatusResponse403 | ReadCliBudgetStatusResponse404 | ReadCliBudgetStatusResponse409 | ReadCliBudgetStatusResponse412 | ReadCliBudgetStatusResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
