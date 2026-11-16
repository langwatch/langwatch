from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.register_connected_agent_instance_body import RegisterConnectedAgentInstanceBody
from ...models.register_connected_agent_instance_response_200 import RegisterConnectedAgentInstanceResponse200
from ...models.register_connected_agent_instance_response_400 import RegisterConnectedAgentInstanceResponse400
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: RegisterConnectedAgentInstanceBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/agents/connect/register",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400 | None:
    if response.status_code == 200:
        response_200 = RegisterConnectedAgentInstanceResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = RegisterConnectedAgentInstanceResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400]:
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
    body: RegisterConnectedAgentInstanceBody,
) -> Response[RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400]:
    """Register this process's agents

     Returns a registered frame and instance token, or refuses at the status of the reason.

    Args:
        body (RegisterConnectedAgentInstanceBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400]
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
    body: RegisterConnectedAgentInstanceBody,
) -> RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400 | None:
    """Register this process's agents

     Returns a registered frame and instance token, or refuses at the status of the reason.

    Args:
        body (RegisterConnectedAgentInstanceBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: RegisterConnectedAgentInstanceBody,
) -> Response[RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400]:
    """Register this process's agents

     Returns a registered frame and instance token, or refuses at the status of the reason.

    Args:
        body (RegisterConnectedAgentInstanceBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: RegisterConnectedAgentInstanceBody,
) -> RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400 | None:
    """Register this process's agents

     Returns a registered frame and instance token, or refuses at the status of the reason.

    Args:
        body (RegisterConnectedAgentInstanceBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RegisterConnectedAgentInstanceResponse200 | RegisterConnectedAgentInstanceResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
