from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_me_project_response_200 import GetApiMeProjectResponse200
from ...models.get_api_me_project_response_400 import GetApiMeProjectResponse400
from ...models.get_api_me_project_response_401 import GetApiMeProjectResponse401
from ...models.get_api_me_project_response_422 import GetApiMeProjectResponse422
from ...models.get_api_me_project_response_500 import GetApiMeProjectResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/me/project",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiMeProjectResponse200
    | GetApiMeProjectResponse400
    | GetApiMeProjectResponse401
    | GetApiMeProjectResponse422
    | GetApiMeProjectResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiMeProjectResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiMeProjectResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiMeProjectResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiMeProjectResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiMeProjectResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiMeProjectResponse200
    | GetApiMeProjectResponse400
    | GetApiMeProjectResponse401
    | GetApiMeProjectResponse422
    | GetApiMeProjectResponse500
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
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiMeProjectResponse200
    | GetApiMeProjectResponse400
    | GetApiMeProjectResponse401
    | GetApiMeProjectResponse422
    | GetApiMeProjectResponse500
]:
    """Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal
    workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key
    targets without any further access.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiMeProjectResponse200 | GetApiMeProjectResponse400 | GetApiMeProjectResponse401 | GetApiMeProjectResponse422 | GetApiMeProjectResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiMeProjectResponse200
    | GetApiMeProjectResponse400
    | GetApiMeProjectResponse401
    | GetApiMeProjectResponse422
    | GetApiMeProjectResponse500
    | None
):
    """Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal
    workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key
    targets without any further access.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiMeProjectResponse200 | GetApiMeProjectResponse400 | GetApiMeProjectResponse401 | GetApiMeProjectResponse422 | GetApiMeProjectResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiMeProjectResponse200
    | GetApiMeProjectResponse400
    | GetApiMeProjectResponse401
    | GetApiMeProjectResponse422
    | GetApiMeProjectResponse500
]:
    """Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal
    workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key
    targets without any further access.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiMeProjectResponse200 | GetApiMeProjectResponse400 | GetApiMeProjectResponse401 | GetApiMeProjectResponse422 | GetApiMeProjectResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiMeProjectResponse200
    | GetApiMeProjectResponse400
    | GetApiMeProjectResponse401
    | GetApiMeProjectResponse422
    | GetApiMeProjectResponse500
    | None
):
    """Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal
    workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key
    targets without any further access.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiMeProjectResponse200 | GetApiMeProjectResponse400 | GetApiMeProjectResponse401 | GetApiMeProjectResponse422 | GetApiMeProjectResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
