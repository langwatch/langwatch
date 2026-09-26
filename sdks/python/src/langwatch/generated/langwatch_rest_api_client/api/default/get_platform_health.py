from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_platform_health_response_200 import GetPlatformHealthResponse200
from ...models.get_platform_health_response_503 import GetPlatformHealthResponse503
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    trigger_id: str | Unset = UNSET,
    workflow_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["triggerId"] = trigger_id

    params["workflowId"] = workflow_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/platform-health",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetPlatformHealthResponse200 | GetPlatformHealthResponse503 | None:
    if response.status_code == 200:
        response_200 = GetPlatformHealthResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 503:
        response_503 = GetPlatformHealthResponse503.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetPlatformHealthResponse200 | GetPlatformHealthResponse503]:
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
    trigger_id: str | Unset = UNSET,
    workflow_id: str | Unset = UNSET,
) -> Response[GetPlatformHealthResponse200 | GetPlatformHealthResponse503]:
    """Report whether the platform is working

     An external monitor reads a status and a report: 200 healthy or degraded, 503 unhealthy, 401
    unauthorized and 404 for a subsystem this platform does not have.

    Args:
        trigger_id (str | Unset):
        workflow_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetPlatformHealthResponse200 | GetPlatformHealthResponse503]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
        workflow_id=workflow_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    trigger_id: str | Unset = UNSET,
    workflow_id: str | Unset = UNSET,
) -> GetPlatformHealthResponse200 | GetPlatformHealthResponse503 | None:
    """Report whether the platform is working

     An external monitor reads a status and a report: 200 healthy or degraded, 503 unhealthy, 401
    unauthorized and 404 for a subsystem this platform does not have.

    Args:
        trigger_id (str | Unset):
        workflow_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetPlatformHealthResponse200 | GetPlatformHealthResponse503
    """

    return sync_detailed(
        client=client,
        trigger_id=trigger_id,
        workflow_id=workflow_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    trigger_id: str | Unset = UNSET,
    workflow_id: str | Unset = UNSET,
) -> Response[GetPlatformHealthResponse200 | GetPlatformHealthResponse503]:
    """Report whether the platform is working

     An external monitor reads a status and a report: 200 healthy or degraded, 503 unhealthy, 401
    unauthorized and 404 for a subsystem this platform does not have.

    Args:
        trigger_id (str | Unset):
        workflow_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetPlatformHealthResponse200 | GetPlatformHealthResponse503]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
        workflow_id=workflow_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    trigger_id: str | Unset = UNSET,
    workflow_id: str | Unset = UNSET,
) -> GetPlatformHealthResponse200 | GetPlatformHealthResponse503 | None:
    """Report whether the platform is working

     An external monitor reads a status and a report: 200 healthy or degraded, 503 unhealthy, 401
    unauthorized and 404 for a subsystem this platform does not have.

    Args:
        trigger_id (str | Unset):
        workflow_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetPlatformHealthResponse200 | GetPlatformHealthResponse503
    """

    return (
        await asyncio_detailed(
            client=client,
            trigger_id=trigger_id,
            workflow_id=workflow_id,
        )
    ).parsed
