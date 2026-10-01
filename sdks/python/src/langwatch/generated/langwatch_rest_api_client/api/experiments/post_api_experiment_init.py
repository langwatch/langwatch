from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: Any,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/experiment/init",
    }

    _kwargs["json"] = body

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if response.status_code == 400:
        return None

    if response.status_code == 401:
        return None

    if response.status_code == 403:
        return None

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
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
    body: Any,
) -> Response[Any]:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you. The body carries
    `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what
    makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and
    `workflowId` ties it to an Optimization Studio workflow.

    Args:
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: Any,
) -> Response[Any]:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you. The body carries
    `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what
    makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and
    `workflowId` ties it to an Optimization Studio workflow.

    Args:
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
