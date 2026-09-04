from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.register_connected_agent_instance_body import RegisterConnectedAgentInstanceBody
from ...models.register_connected_agent_instance_response_200 import RegisterConnectedAgentInstanceResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: RegisterConnectedAgentInstanceBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/agents/connect/register",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | RegisterConnectedAgentInstanceResponse200 | None:
    if response.status_code == 200:
        response_200 = RegisterConnectedAgentInstanceResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 422:
        response_422 = cast(Any, None)
        return response_422

    if response.status_code == 503:
        response_503 = cast(Any, None)
        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | RegisterConnectedAgentInstanceResponse200]:
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
    body: RegisterConnectedAgentInstanceBody | Unset = UNSET,
) -> Response[Any | RegisterConnectedAgentInstanceResponse200]:
    """Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body
    is the register frame of the connect protocol. Answers with the registered frame and the instance
    token the poll and frames endpoints are addressed with, or with a refused frame.

    Args:
        body (RegisterConnectedAgentInstanceBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | RegisterConnectedAgentInstanceResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: RegisterConnectedAgentInstanceBody | Unset = UNSET,
) -> Any | RegisterConnectedAgentInstanceResponse200 | None:
    """Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body
    is the register frame of the connect protocol. Answers with the registered frame and the instance
    token the poll and frames endpoints are addressed with, or with a refused frame.

    Args:
        body (RegisterConnectedAgentInstanceBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | RegisterConnectedAgentInstanceResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: RegisterConnectedAgentInstanceBody | Unset = UNSET,
) -> Response[Any | RegisterConnectedAgentInstanceResponse200]:
    """Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body
    is the register frame of the connect protocol. Answers with the registered frame and the instance
    token the poll and frames endpoints are addressed with, or with a refused frame.

    Args:
        body (RegisterConnectedAgentInstanceBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | RegisterConnectedAgentInstanceResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: RegisterConnectedAgentInstanceBody | Unset = UNSET,
) -> Any | RegisterConnectedAgentInstanceResponse200 | None:
    """Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body
    is the register frame of the connect protocol. Answers with the registered frame and the instance
    token the poll and frames endpoints are addressed with, or with a refused frame.

    Args:
        body (RegisterConnectedAgentInstanceBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | RegisterConnectedAgentInstanceResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
