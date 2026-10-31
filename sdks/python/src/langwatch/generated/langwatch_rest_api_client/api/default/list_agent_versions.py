from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_agent_versions_response_200 import ListAgentVersionsResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    agent_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/agents/{agent_id}/versions".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListAgentVersionsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListAgentVersionsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListAgentVersionsResponse200]:
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
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[ListAgentVersionsResponse200]:
    """List an agent's versions, newest first, with the labels on each

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListAgentVersionsResponse200]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> ListAgentVersionsResponse200 | None:
    """List an agent's versions, newest first, with the labels on each

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListAgentVersionsResponse200
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[ListAgentVersionsResponse200]:
    """List an agent's versions, newest first, with the labels on each

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListAgentVersionsResponse200]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> ListAgentVersionsResponse200 | None:
    """List an agent's versions, newest first, with the labels on each

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListAgentVersionsResponse200
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
        )
    ).parsed
