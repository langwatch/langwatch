from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_traces_by_trace_id_transcript_response_200 import GetApiTracesByTraceIdTranscriptResponse200
from ...models.get_api_traces_by_trace_id_transcript_response_400 import GetApiTracesByTraceIdTranscriptResponse400
from ...models.get_api_traces_by_trace_id_transcript_response_401 import GetApiTracesByTraceIdTranscriptResponse401
from ...models.get_api_traces_by_trace_id_transcript_response_404 import GetApiTracesByTraceIdTranscriptResponse404
from ...models.get_api_traces_by_trace_id_transcript_response_409 import GetApiTracesByTraceIdTranscriptResponse409
from ...models.get_api_traces_by_trace_id_transcript_response_422 import GetApiTracesByTraceIdTranscriptResponse422
from ...models.get_api_traces_by_trace_id_transcript_response_500 import GetApiTracesByTraceIdTranscriptResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    trace_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/traces/{trace_id}/transcript".format(
            trace_id=quote(str(trace_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiTracesByTraceIdTranscriptResponse200
    | GetApiTracesByTraceIdTranscriptResponse400
    | GetApiTracesByTraceIdTranscriptResponse401
    | GetApiTracesByTraceIdTranscriptResponse404
    | GetApiTracesByTraceIdTranscriptResponse409
    | GetApiTracesByTraceIdTranscriptResponse422
    | GetApiTracesByTraceIdTranscriptResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiTracesByTraceIdTranscriptResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiTracesByTraceIdTranscriptResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiTracesByTraceIdTranscriptResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiTracesByTraceIdTranscriptResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = GetApiTracesByTraceIdTranscriptResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = GetApiTracesByTraceIdTranscriptResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiTracesByTraceIdTranscriptResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiTracesByTraceIdTranscriptResponse200
    | GetApiTracesByTraceIdTranscriptResponse400
    | GetApiTracesByTraceIdTranscriptResponse401
    | GetApiTracesByTraceIdTranscriptResponse404
    | GetApiTracesByTraceIdTranscriptResponse409
    | GetApiTracesByTraceIdTranscriptResponse422
    | GetApiTracesByTraceIdTranscriptResponse500
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
    trace_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiTracesByTraceIdTranscriptResponse200
    | GetApiTracesByTraceIdTranscriptResponse400
    | GetApiTracesByTraceIdTranscriptResponse401
    | GetApiTracesByTraceIdTranscriptResponse404
    | GetApiTracesByTraceIdTranscriptResponse409
    | GetApiTracesByTraceIdTranscriptResponse422
    | GetApiTracesByTraceIdTranscriptResponse500
]:
    """Derived coding-agent transcript for a trace: what the agent did, in order, with per-call token and
    cost economics. Empty entries for traces without coding-agent content.

    Args:
        trace_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTracesByTraceIdTranscriptResponse200 | GetApiTracesByTraceIdTranscriptResponse400 | GetApiTracesByTraceIdTranscriptResponse401 | GetApiTracesByTraceIdTranscriptResponse404 | GetApiTracesByTraceIdTranscriptResponse409 | GetApiTracesByTraceIdTranscriptResponse422 | GetApiTracesByTraceIdTranscriptResponse500]
    """

    kwargs = _get_kwargs(
        trace_id=trace_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    trace_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiTracesByTraceIdTranscriptResponse200
    | GetApiTracesByTraceIdTranscriptResponse400
    | GetApiTracesByTraceIdTranscriptResponse401
    | GetApiTracesByTraceIdTranscriptResponse404
    | GetApiTracesByTraceIdTranscriptResponse409
    | GetApiTracesByTraceIdTranscriptResponse422
    | GetApiTracesByTraceIdTranscriptResponse500
    | None
):
    """Derived coding-agent transcript for a trace: what the agent did, in order, with per-call token and
    cost economics. Empty entries for traces without coding-agent content.

    Args:
        trace_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTracesByTraceIdTranscriptResponse200 | GetApiTracesByTraceIdTranscriptResponse400 | GetApiTracesByTraceIdTranscriptResponse401 | GetApiTracesByTraceIdTranscriptResponse404 | GetApiTracesByTraceIdTranscriptResponse409 | GetApiTracesByTraceIdTranscriptResponse422 | GetApiTracesByTraceIdTranscriptResponse500
    """

    return sync_detailed(
        trace_id=trace_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    trace_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiTracesByTraceIdTranscriptResponse200
    | GetApiTracesByTraceIdTranscriptResponse400
    | GetApiTracesByTraceIdTranscriptResponse401
    | GetApiTracesByTraceIdTranscriptResponse404
    | GetApiTracesByTraceIdTranscriptResponse409
    | GetApiTracesByTraceIdTranscriptResponse422
    | GetApiTracesByTraceIdTranscriptResponse500
]:
    """Derived coding-agent transcript for a trace: what the agent did, in order, with per-call token and
    cost economics. Empty entries for traces without coding-agent content.

    Args:
        trace_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTracesByTraceIdTranscriptResponse200 | GetApiTracesByTraceIdTranscriptResponse400 | GetApiTracesByTraceIdTranscriptResponse401 | GetApiTracesByTraceIdTranscriptResponse404 | GetApiTracesByTraceIdTranscriptResponse409 | GetApiTracesByTraceIdTranscriptResponse422 | GetApiTracesByTraceIdTranscriptResponse500]
    """

    kwargs = _get_kwargs(
        trace_id=trace_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    trace_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiTracesByTraceIdTranscriptResponse200
    | GetApiTracesByTraceIdTranscriptResponse400
    | GetApiTracesByTraceIdTranscriptResponse401
    | GetApiTracesByTraceIdTranscriptResponse404
    | GetApiTracesByTraceIdTranscriptResponse409
    | GetApiTracesByTraceIdTranscriptResponse422
    | GetApiTracesByTraceIdTranscriptResponse500
    | None
):
    """Derived coding-agent transcript for a trace: what the agent did, in order, with per-call token and
    cost economics. Empty entries for traces without coding-agent content.

    Args:
        trace_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTracesByTraceIdTranscriptResponse200 | GetApiTracesByTraceIdTranscriptResponse400 | GetApiTracesByTraceIdTranscriptResponse401 | GetApiTracesByTraceIdTranscriptResponse404 | GetApiTracesByTraceIdTranscriptResponse409 | GetApiTracesByTraceIdTranscriptResponse422 | GetApiTracesByTraceIdTranscriptResponse500
    """

    return (
        await asyncio_detailed(
            trace_id=trace_id,
            client=client,
        )
    ).parsed
