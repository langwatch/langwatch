from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.submit_bug_report_body import SubmitBugReportBody
from ...models.submit_bug_report_response_400 import SubmitBugReportResponse400
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: SubmitBugReportBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/bug-reports",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | SubmitBugReportResponse400 | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 400:
        response_400 = SubmitBugReportResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | SubmitBugReportResponse400]:
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
    body: SubmitBugReportBody,
) -> Response[Any | SubmitBugReportResponse400]:
    """File an issue report from a coding agent

     released CLI and MCP builds parse the intake's own bodies: { id } on 201, { error, details } on a
    rejected report, { error, code } on a named refusal

    Args:
        body (SubmitBugReportBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | SubmitBugReportResponse400]
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
    body: SubmitBugReportBody,
) -> Any | SubmitBugReportResponse400 | None:
    """File an issue report from a coding agent

     released CLI and MCP builds parse the intake's own bodies: { id } on 201, { error, details } on a
    rejected report, { error, code } on a named refusal

    Args:
        body (SubmitBugReportBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | SubmitBugReportResponse400
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: SubmitBugReportBody,
) -> Response[Any | SubmitBugReportResponse400]:
    """File an issue report from a coding agent

     released CLI and MCP builds parse the intake's own bodies: { id } on 201, { error, details } on a
    rejected report, { error, code } on a named refusal

    Args:
        body (SubmitBugReportBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | SubmitBugReportResponse400]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: SubmitBugReportBody,
) -> Any | SubmitBugReportResponse400 | None:
    """File an issue report from a coding agent

     released CLI and MCP builds parse the intake's own bodies: { id } on 201, { error, details } on a
    rejected report, { error, code } on a named refusal

    Args:
        body (SubmitBugReportBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | SubmitBugReportResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
