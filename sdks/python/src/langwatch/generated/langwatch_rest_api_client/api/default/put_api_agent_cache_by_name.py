from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_agent_cache_by_name_body import PutApiAgentCacheByNameBody
from ...models.put_api_agent_cache_by_name_response_200 import PutApiAgentCacheByNameResponse200
from ...models.put_api_agent_cache_by_name_response_400 import PutApiAgentCacheByNameResponse400
from ...models.put_api_agent_cache_by_name_response_401 import PutApiAgentCacheByNameResponse401
from ...models.put_api_agent_cache_by_name_response_403 import PutApiAgentCacheByNameResponse403
from ...models.put_api_agent_cache_by_name_response_500 import PutApiAgentCacheByNameResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    name: str,
    *,
    body: PutApiAgentCacheByNameBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/agent-cache/{name}".format(
            name=quote(str(name), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PutApiAgentCacheByNameResponse200
    | PutApiAgentCacheByNameResponse400
    | PutApiAgentCacheByNameResponse401
    | PutApiAgentCacheByNameResponse403
    | PutApiAgentCacheByNameResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiAgentCacheByNameResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiAgentCacheByNameResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiAgentCacheByNameResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PutApiAgentCacheByNameResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PutApiAgentCacheByNameResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiAgentCacheByNameResponse200
    | PutApiAgentCacheByNameResponse400
    | PutApiAgentCacheByNameResponse401
    | PutApiAgentCacheByNameResponse403
    | PutApiAgentCacheByNameResponse500
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
    body: PutApiAgentCacheByNameBody,
) -> Response[
    PutApiAgentCacheByNameResponse200
    | PutApiAgentCacheByNameResponse400
    | PutApiAgentCacheByNameResponse401
    | PutApiAgentCacheByNameResponse403
    | PutApiAgentCacheByNameResponse500
]:
    """Store a value under a name, whether or not the name is held yet. The value is encrypted at rest and
    expires by itself after ttl_seconds, which defaults to 900 seconds. The last write wins.

    Args:
        name (str):
        body (PutApiAgentCacheByNameBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiAgentCacheByNameResponse200 | PutApiAgentCacheByNameResponse400 | PutApiAgentCacheByNameResponse401 | PutApiAgentCacheByNameResponse403 | PutApiAgentCacheByNameResponse500]
    """

    kwargs = _get_kwargs(
        name=name,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    name: str,
    *,
    client: AuthenticatedClient,
    body: PutApiAgentCacheByNameBody,
) -> (
    PutApiAgentCacheByNameResponse200
    | PutApiAgentCacheByNameResponse400
    | PutApiAgentCacheByNameResponse401
    | PutApiAgentCacheByNameResponse403
    | PutApiAgentCacheByNameResponse500
    | None
):
    """Store a value under a name, whether or not the name is held yet. The value is encrypted at rest and
    expires by itself after ttl_seconds, which defaults to 900 seconds. The last write wins.

    Args:
        name (str):
        body (PutApiAgentCacheByNameBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiAgentCacheByNameResponse200 | PutApiAgentCacheByNameResponse400 | PutApiAgentCacheByNameResponse401 | PutApiAgentCacheByNameResponse403 | PutApiAgentCacheByNameResponse500
    """

    return sync_detailed(
        name=name,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    name: str,
    *,
    client: AuthenticatedClient,
    body: PutApiAgentCacheByNameBody,
) -> Response[
    PutApiAgentCacheByNameResponse200
    | PutApiAgentCacheByNameResponse400
    | PutApiAgentCacheByNameResponse401
    | PutApiAgentCacheByNameResponse403
    | PutApiAgentCacheByNameResponse500
]:
    """Store a value under a name, whether or not the name is held yet. The value is encrypted at rest and
    expires by itself after ttl_seconds, which defaults to 900 seconds. The last write wins.

    Args:
        name (str):
        body (PutApiAgentCacheByNameBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiAgentCacheByNameResponse200 | PutApiAgentCacheByNameResponse400 | PutApiAgentCacheByNameResponse401 | PutApiAgentCacheByNameResponse403 | PutApiAgentCacheByNameResponse500]
    """

    kwargs = _get_kwargs(
        name=name,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    name: str,
    *,
    client: AuthenticatedClient,
    body: PutApiAgentCacheByNameBody,
) -> (
    PutApiAgentCacheByNameResponse200
    | PutApiAgentCacheByNameResponse400
    | PutApiAgentCacheByNameResponse401
    | PutApiAgentCacheByNameResponse403
    | PutApiAgentCacheByNameResponse500
    | None
):
    """Store a value under a name, whether or not the name is held yet. The value is encrypted at rest and
    expires by itself after ttl_seconds, which defaults to 900 seconds. The last write wins.

    Args:
        name (str):
        body (PutApiAgentCacheByNameBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiAgentCacheByNameResponse200 | PutApiAgentCacheByNameResponse400 | PutApiAgentCacheByNameResponse401 | PutApiAgentCacheByNameResponse403 | PutApiAgentCacheByNameResponse500
    """

    return (
        await asyncio_detailed(
            name=name,
            client=client,
            body=body,
        )
    ).parsed
