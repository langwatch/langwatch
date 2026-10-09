from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_connected_agent_frames_body import PostConnectedAgentFramesBody
from ...models.post_connected_agent_frames_response_200 import PostConnectedAgentFramesResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostConnectedAgentFramesBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/agents/connect/frames",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | PostConnectedAgentFramesResponse200 | None:
    if response.status_code == 200:
        response_200 = PostConnectedAgentFramesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 410:
        response_410 = cast(Any, None)
        return response_410

    if response.status_code == 422:
        response_422 = cast(Any, None)
        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | PostConnectedAgentFramesResponse200]:
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
    body: PostConnectedAgentFramesBody | Unset = UNSET,
) -> Response[Any | PostConnectedAgentFramesResponse200]:
    """Post the ack, result and deregister frames of a registered instance. Addressed with the instance
    token in the X-Agent-Instance-Token header.

    Args:
        body (PostConnectedAgentFramesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostConnectedAgentFramesResponse200]
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
    body: PostConnectedAgentFramesBody | Unset = UNSET,
) -> Any | PostConnectedAgentFramesResponse200 | None:
    """Post the ack, result and deregister frames of a registered instance. Addressed with the instance
    token in the X-Agent-Instance-Token header.

    Args:
        body (PostConnectedAgentFramesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostConnectedAgentFramesResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostConnectedAgentFramesBody | Unset = UNSET,
) -> Response[Any | PostConnectedAgentFramesResponse200]:
    """Post the ack, result and deregister frames of a registered instance. Addressed with the instance
    token in the X-Agent-Instance-Token header.

    Args:
        body (PostConnectedAgentFramesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostConnectedAgentFramesResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostConnectedAgentFramesBody | Unset = UNSET,
) -> Any | PostConnectedAgentFramesResponse200 | None:
    """Post the ack, result and deregister frames of a registered instance. Addressed with the instance
    token in the X-Agent-Instance-Token header.

    Args:
        body (PostConnectedAgentFramesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostConnectedAgentFramesResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
