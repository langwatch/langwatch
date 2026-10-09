from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_agent_cache_by_name_response_200 import DeleteApiAgentCacheByNameResponse200
from ...models.delete_api_agent_cache_by_name_response_400 import DeleteApiAgentCacheByNameResponse400
from ...models.delete_api_agent_cache_by_name_response_401 import DeleteApiAgentCacheByNameResponse401
from ...models.delete_api_agent_cache_by_name_response_403 import DeleteApiAgentCacheByNameResponse403
from ...models.delete_api_agent_cache_by_name_response_500 import DeleteApiAgentCacheByNameResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    name: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/agent-cache/{name}".format(
            name=quote(str(name), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiAgentCacheByNameResponse200
    | DeleteApiAgentCacheByNameResponse400
    | DeleteApiAgentCacheByNameResponse401
    | DeleteApiAgentCacheByNameResponse403
    | DeleteApiAgentCacheByNameResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiAgentCacheByNameResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiAgentCacheByNameResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiAgentCacheByNameResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiAgentCacheByNameResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = DeleteApiAgentCacheByNameResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiAgentCacheByNameResponse200
    | DeleteApiAgentCacheByNameResponse400
    | DeleteApiAgentCacheByNameResponse401
    | DeleteApiAgentCacheByNameResponse403
    | DeleteApiAgentCacheByNameResponse500
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
    name: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiAgentCacheByNameResponse200
    | DeleteApiAgentCacheByNameResponse400
    | DeleteApiAgentCacheByNameResponse401
    | DeleteApiAgentCacheByNameResponse403
    | DeleteApiAgentCacheByNameResponse500
]:
    """Remove a cache entry. A name the project does not hold answers the same as one it does, so a caller
    can clear an entry without reading it first.

    Args:
        name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiAgentCacheByNameResponse200 | DeleteApiAgentCacheByNameResponse400 | DeleteApiAgentCacheByNameResponse401 | DeleteApiAgentCacheByNameResponse403 | DeleteApiAgentCacheByNameResponse500]
    """

    kwargs = _get_kwargs(
        name=name,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    name: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiAgentCacheByNameResponse200
    | DeleteApiAgentCacheByNameResponse400
    | DeleteApiAgentCacheByNameResponse401
    | DeleteApiAgentCacheByNameResponse403
    | DeleteApiAgentCacheByNameResponse500
    | None
):
    """Remove a cache entry. A name the project does not hold answers the same as one it does, so a caller
    can clear an entry without reading it first.

    Args:
        name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiAgentCacheByNameResponse200 | DeleteApiAgentCacheByNameResponse400 | DeleteApiAgentCacheByNameResponse401 | DeleteApiAgentCacheByNameResponse403 | DeleteApiAgentCacheByNameResponse500
    """

    return sync_detailed(
        name=name,
        client=client,
    ).parsed


async def asyncio_detailed(
    name: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiAgentCacheByNameResponse200
    | DeleteApiAgentCacheByNameResponse400
    | DeleteApiAgentCacheByNameResponse401
    | DeleteApiAgentCacheByNameResponse403
    | DeleteApiAgentCacheByNameResponse500
]:
    """Remove a cache entry. A name the project does not hold answers the same as one it does, so a caller
    can clear an entry without reading it first.

    Args:
        name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiAgentCacheByNameResponse200 | DeleteApiAgentCacheByNameResponse400 | DeleteApiAgentCacheByNameResponse401 | DeleteApiAgentCacheByNameResponse403 | DeleteApiAgentCacheByNameResponse500]
    """

    kwargs = _get_kwargs(
        name=name,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    name: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiAgentCacheByNameResponse200
    | DeleteApiAgentCacheByNameResponse400
    | DeleteApiAgentCacheByNameResponse401
    | DeleteApiAgentCacheByNameResponse403
    | DeleteApiAgentCacheByNameResponse500
    | None
):
    """Remove a cache entry. A name the project does not hold answers the same as one it does, so a caller
    can clear an entry without reading it first.

    Args:
        name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiAgentCacheByNameResponse200 | DeleteApiAgentCacheByNameResponse400 | DeleteApiAgentCacheByNameResponse401 | DeleteApiAgentCacheByNameResponse403 | DeleteApiAgentCacheByNameResponse500
    """

    return (
        await asyncio_detailed(
            name=name,
            client=client,
        )
    ).parsed
