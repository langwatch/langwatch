from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.run_run_plan_body import RunRunPlanBody
from ...models.run_run_plan_response_200 import RunRunPlanResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: RunRunPlanBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/run-plans/run",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> RunRunPlanResponse200 | None:
    if response.status_code == 200:
        response_200 = RunRunPlanResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[RunRunPlanResponse200]:
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
    body: RunRunPlanBody,
) -> Response[RunRunPlanResponse200]:
    """Run a configuration under a name. The name identifies the run plan: send a name already in use and
    that plan's configuration is replaced with this one, send a new name and the plan is created, send
    no name and one is derived from what the run covers and what it runs against.

    Args:
        body (RunRunPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RunRunPlanResponse200]
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
    body: RunRunPlanBody,
) -> RunRunPlanResponse200 | None:
    """Run a configuration under a name. The name identifies the run plan: send a name already in use and
    that plan's configuration is replaced with this one, send a new name and the plan is created, send
    no name and one is derived from what the run covers and what it runs against.

    Args:
        body (RunRunPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RunRunPlanResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: RunRunPlanBody,
) -> Response[RunRunPlanResponse200]:
    """Run a configuration under a name. The name identifies the run plan: send a name already in use and
    that plan's configuration is replaced with this one, send a new name and the plan is created, send
    no name and one is derived from what the run covers and what it runs against.

    Args:
        body (RunRunPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RunRunPlanResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: RunRunPlanBody,
) -> RunRunPlanResponse200 | None:
    """Run a configuration under a name. The name identifies the run plan: send a name already in use and
    that plan's configuration is replaced with this one, send a new name and the plan is created, send
    no name and one is derived from what the run covers and what it runs against.

    Args:
        body (RunRunPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RunRunPlanResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
