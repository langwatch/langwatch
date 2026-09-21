from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.poll_connected_agent_instance_response_200 import PollConnectedAgentInstanceResponse200
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/agents/connect/poll",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | PollConnectedAgentInstanceResponse200 | None:
    if response.status_code == 200:
        response_200 = PollConnectedAgentInstanceResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 410:
        response_410 = cast(Any, None)
        return response_410

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | PollConnectedAgentInstanceResponse200]:
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
) -> Response[Any | PollConnectedAgentInstanceResponse200]:
    """Wait for the next call and cancel frames of a registered instance, up to 25 seconds, then answer
    with what is waiting or with an empty list. Each poll refreshes the instance presence, so a process
    that polls reads Online. Addressed with the instance token in the X-Agent-Instance-Token header.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PollConnectedAgentInstanceResponse200]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> Any | PollConnectedAgentInstanceResponse200 | None:
    """Wait for the next call and cancel frames of a registered instance, up to 25 seconds, then answer
    with what is waiting or with an empty list. Each poll refreshes the instance presence, so a process
    that polls reads Online. Addressed with the instance token in the X-Agent-Instance-Token header.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PollConnectedAgentInstanceResponse200
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[Any | PollConnectedAgentInstanceResponse200]:
    """Wait for the next call and cancel frames of a registered instance, up to 25 seconds, then answer
    with what is waiting or with an empty list. Each poll refreshes the instance presence, so a process
    that polls reads Online. Addressed with the instance token in the X-Agent-Instance-Token header.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PollConnectedAgentInstanceResponse200]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> Any | PollConnectedAgentInstanceResponse200 | None:
    """Wait for the next call and cancel frames of a registered instance, up to 25 seconds, then answer
    with what is waiting or with an empty list. Each poll refreshes the instance presence, so a process
    that polls reads Online. Addressed with the instance token in the X-Agent-Instance-Token header.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PollConnectedAgentInstanceResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
