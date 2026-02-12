from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_traces_by_trace_id_format import GetApiTracesByTraceIdFormat
from ...models.get_api_traces_by_trace_id_llm_mode import GetApiTracesByTraceIdLlmMode
from ...models.get_api_traces_by_trace_id_response_200 import GetApiTracesByTraceIdResponse200
from ...models.get_api_traces_by_trace_id_response_400 import GetApiTracesByTraceIdResponse400
from ...models.get_api_traces_by_trace_id_response_401 import GetApiTracesByTraceIdResponse401
from ...models.get_api_traces_by_trace_id_response_404 import GetApiTracesByTraceIdResponse404
from ...models.get_api_traces_by_trace_id_response_422 import GetApiTracesByTraceIdResponse422
from ...models.get_api_traces_by_trace_id_response_500 import GetApiTracesByTraceIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    trace_id: str,
    *,
    format_: GetApiTracesByTraceIdFormat | Unset = UNSET,
    llm_mode: GetApiTracesByTraceIdLlmMode | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_.value

    params["format"] = json_format_

    json_llm_mode: str | Unset = UNSET
    if not isinstance(llm_mode, Unset):
        json_llm_mode = llm_mode.value

    params["llmMode"] = json_llm_mode

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/traces/{trace_id}".format(
            trace_id=quote(str(trace_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiTracesByTraceIdResponse200
    | GetApiTracesByTraceIdResponse400
    | GetApiTracesByTraceIdResponse401
    | GetApiTracesByTraceIdResponse404
    | GetApiTracesByTraceIdResponse422
    | GetApiTracesByTraceIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiTracesByTraceIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiTracesByTraceIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiTracesByTraceIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiTracesByTraceIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiTracesByTraceIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiTracesByTraceIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiTracesByTraceIdResponse200
    | GetApiTracesByTraceIdResponse400
    | GetApiTracesByTraceIdResponse401
    | GetApiTracesByTraceIdResponse404
    | GetApiTracesByTraceIdResponse422
    | GetApiTracesByTraceIdResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiTracesByTraceIdFormat | Unset = UNSET,
    llm_mode: GetApiTracesByTraceIdLlmMode | Unset = UNSET,
) -> Response[
    GetApiTracesByTraceIdResponse200
    | GetApiTracesByTraceIdResponse400
    | GetApiTracesByTraceIdResponse401
    | GetApiTracesByTraceIdResponse404
    | GetApiTracesByTraceIdResponse422
    | GetApiTracesByTraceIdResponse500
]:
    """Get a single trace by ID. Defaults to AI-readable digest format.

    Args:
        trace_id (str):
        format_ (GetApiTracesByTraceIdFormat | Unset):
        llm_mode (GetApiTracesByTraceIdLlmMode | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTracesByTraceIdResponse200 | GetApiTracesByTraceIdResponse400 | GetApiTracesByTraceIdResponse401 | GetApiTracesByTraceIdResponse404 | GetApiTracesByTraceIdResponse422 | GetApiTracesByTraceIdResponse500]
    """

    kwargs = _get_kwargs(
        trace_id=trace_id,
        format_=format_,
        llm_mode=llm_mode,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiTracesByTraceIdFormat | Unset = UNSET,
    llm_mode: GetApiTracesByTraceIdLlmMode | Unset = UNSET,
) -> (
    GetApiTracesByTraceIdResponse200
    | GetApiTracesByTraceIdResponse400
    | GetApiTracesByTraceIdResponse401
    | GetApiTracesByTraceIdResponse404
    | GetApiTracesByTraceIdResponse422
    | GetApiTracesByTraceIdResponse500
    | None
):
    """Get a single trace by ID. Defaults to AI-readable digest format.

    Args:
        trace_id (str):
        format_ (GetApiTracesByTraceIdFormat | Unset):
        llm_mode (GetApiTracesByTraceIdLlmMode | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTracesByTraceIdResponse200 | GetApiTracesByTraceIdResponse400 | GetApiTracesByTraceIdResponse401 | GetApiTracesByTraceIdResponse404 | GetApiTracesByTraceIdResponse422 | GetApiTracesByTraceIdResponse500
    """

    return sync_detailed(
        trace_id=trace_id,
        client=client,
        format_=format_,
        llm_mode=llm_mode,
    ).parsed


async def asyncio_detailed(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiTracesByTraceIdFormat | Unset = UNSET,
    llm_mode: GetApiTracesByTraceIdLlmMode | Unset = UNSET,
) -> Response[
    GetApiTracesByTraceIdResponse200
    | GetApiTracesByTraceIdResponse400
    | GetApiTracesByTraceIdResponse401
    | GetApiTracesByTraceIdResponse404
    | GetApiTracesByTraceIdResponse422
    | GetApiTracesByTraceIdResponse500
]:
    """Get a single trace by ID. Defaults to AI-readable digest format.

    Args:
        trace_id (str):
        format_ (GetApiTracesByTraceIdFormat | Unset):
        llm_mode (GetApiTracesByTraceIdLlmMode | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTracesByTraceIdResponse200 | GetApiTracesByTraceIdResponse400 | GetApiTracesByTraceIdResponse401 | GetApiTracesByTraceIdResponse404 | GetApiTracesByTraceIdResponse422 | GetApiTracesByTraceIdResponse500]
    """

    kwargs = _get_kwargs(
        trace_id=trace_id,
        format_=format_,
        llm_mode=llm_mode,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiTracesByTraceIdFormat | Unset = UNSET,
    llm_mode: GetApiTracesByTraceIdLlmMode | Unset = UNSET,
) -> (
    GetApiTracesByTraceIdResponse200
    | GetApiTracesByTraceIdResponse400
    | GetApiTracesByTraceIdResponse401
    | GetApiTracesByTraceIdResponse404
    | GetApiTracesByTraceIdResponse422
    | GetApiTracesByTraceIdResponse500
    | None
):
    """Get a single trace by ID. Defaults to AI-readable digest format.

    Args:
        trace_id (str):
        format_ (GetApiTracesByTraceIdFormat | Unset):
        llm_mode (GetApiTracesByTraceIdLlmMode | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTracesByTraceIdResponse200 | GetApiTracesByTraceIdResponse400 | GetApiTracesByTraceIdResponse401 | GetApiTracesByTraceIdResponse404 | GetApiTracesByTraceIdResponse422 | GetApiTracesByTraceIdResponse500
    """

    return (
        await asyncio_detailed(
            trace_id=trace_id,
            client=client,
            format_=format_,
            llm_mode=llm_mode,
        )
    ).parsed
