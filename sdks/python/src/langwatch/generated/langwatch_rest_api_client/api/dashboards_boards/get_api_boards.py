from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_boards_response_200 import GetApiBoardsResponse200
from ...models.get_api_boards_response_400 import GetApiBoardsResponse400
from ...models.get_api_boards_response_401 import GetApiBoardsResponse401
from ...models.get_api_boards_response_403 import GetApiBoardsResponse403
from ...models.get_api_boards_response_500 import GetApiBoardsResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/boards",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiBoardsResponse200
    | GetApiBoardsResponse400
    | GetApiBoardsResponse401
    | GetApiBoardsResponse403
    | GetApiBoardsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiBoardsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiBoardsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiBoardsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiBoardsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiBoardsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiBoardsResponse200
    | GetApiBoardsResponse400
    | GetApiBoardsResponse401
    | GetApiBoardsResponse403
    | GetApiBoardsResponse500
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
    GetApiBoardsResponse200
    | GetApiBoardsResponse400
    | GetApiBoardsResponse401
    | GetApiBoardsResponse403
    | GetApiBoardsResponse500
]:
    """List boards

     Lists the Dashboards boards of the key's project, each with how many widgets it holds.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiBoardsResponse200 | GetApiBoardsResponse400 | GetApiBoardsResponse401 | GetApiBoardsResponse403 | GetApiBoardsResponse500]
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
    GetApiBoardsResponse200
    | GetApiBoardsResponse400
    | GetApiBoardsResponse401
    | GetApiBoardsResponse403
    | GetApiBoardsResponse500
    | None
):
    """List boards

     Lists the Dashboards boards of the key's project, each with how many widgets it holds.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiBoardsResponse200 | GetApiBoardsResponse400 | GetApiBoardsResponse401 | GetApiBoardsResponse403 | GetApiBoardsResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiBoardsResponse200
    | GetApiBoardsResponse400
    | GetApiBoardsResponse401
    | GetApiBoardsResponse403
    | GetApiBoardsResponse500
]:
    """List boards

     Lists the Dashboards boards of the key's project, each with how many widgets it holds.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiBoardsResponse200 | GetApiBoardsResponse400 | GetApiBoardsResponse401 | GetApiBoardsResponse403 | GetApiBoardsResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiBoardsResponse200
    | GetApiBoardsResponse400
    | GetApiBoardsResponse401
    | GetApiBoardsResponse403
    | GetApiBoardsResponse500
    | None
):
    """List boards

     Lists the Dashboards boards of the key's project, each with how many widgets it holds.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiBoardsResponse200 | GetApiBoardsResponse400 | GetApiBoardsResponse401 | GetApiBoardsResponse403 | GetApiBoardsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
