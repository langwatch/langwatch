from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_traces_by_trace_id_metadata_body import PatchApiTracesByTraceIdMetadataBody
from ...models.patch_api_traces_by_trace_id_metadata_response_200 import PatchApiTracesByTraceIdMetadataResponse200
from ...models.patch_api_traces_by_trace_id_metadata_response_400 import PatchApiTracesByTraceIdMetadataResponse400
from ...models.patch_api_traces_by_trace_id_metadata_response_401 import PatchApiTracesByTraceIdMetadataResponse401
from ...models.patch_api_traces_by_trace_id_metadata_response_422 import PatchApiTracesByTraceIdMetadataResponse422
from ...models.patch_api_traces_by_trace_id_metadata_response_500 import PatchApiTracesByTraceIdMetadataResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    trace_id: str,
    *,
    body: PatchApiTracesByTraceIdMetadataBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/traces/{trace_id}/metadata".format(
            trace_id=quote(str(trace_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiTracesByTraceIdMetadataResponse200
    | PatchApiTracesByTraceIdMetadataResponse400
    | PatchApiTracesByTraceIdMetadataResponse401
    | PatchApiTracesByTraceIdMetadataResponse422
    | PatchApiTracesByTraceIdMetadataResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiTracesByTraceIdMetadataResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiTracesByTraceIdMetadataResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiTracesByTraceIdMetadataResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PatchApiTracesByTraceIdMetadataResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiTracesByTraceIdMetadataResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiTracesByTraceIdMetadataResponse200
    | PatchApiTracesByTraceIdMetadataResponse400
    | PatchApiTracesByTraceIdMetadataResponse401
    | PatchApiTracesByTraceIdMetadataResponse422
    | PatchApiTracesByTraceIdMetadataResponse500
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
    client: AuthenticatedClient | Client,
    body: PatchApiTracesByTraceIdMetadataBody | Unset = UNSET,
) -> Response[
    PatchApiTracesByTraceIdMetadataResponse200
    | PatchApiTracesByTraceIdMetadataResponse400
    | PatchApiTracesByTraceIdMetadataResponse401
    | PatchApiTracesByTraceIdMetadataResponse422
    | PatchApiTracesByTraceIdMetadataResponse500
]:
    """Update trace metadata

     Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes
    through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys
    are preserved. Labels replace entirely.

    Args:
        trace_id (str):
        body (PatchApiTracesByTraceIdMetadataBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiTracesByTraceIdMetadataResponse200 | PatchApiTracesByTraceIdMetadataResponse400 | PatchApiTracesByTraceIdMetadataResponse401 | PatchApiTracesByTraceIdMetadataResponse422 | PatchApiTracesByTraceIdMetadataResponse500]
    """

    kwargs = _get_kwargs(
        trace_id=trace_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PatchApiTracesByTraceIdMetadataBody | Unset = UNSET,
) -> (
    PatchApiTracesByTraceIdMetadataResponse200
    | PatchApiTracesByTraceIdMetadataResponse400
    | PatchApiTracesByTraceIdMetadataResponse401
    | PatchApiTracesByTraceIdMetadataResponse422
    | PatchApiTracesByTraceIdMetadataResponse500
    | None
):
    """Update trace metadata

     Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes
    through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys
    are preserved. Labels replace entirely.

    Args:
        trace_id (str):
        body (PatchApiTracesByTraceIdMetadataBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiTracesByTraceIdMetadataResponse200 | PatchApiTracesByTraceIdMetadataResponse400 | PatchApiTracesByTraceIdMetadataResponse401 | PatchApiTracesByTraceIdMetadataResponse422 | PatchApiTracesByTraceIdMetadataResponse500
    """

    return sync_detailed(
        trace_id=trace_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PatchApiTracesByTraceIdMetadataBody | Unset = UNSET,
) -> Response[
    PatchApiTracesByTraceIdMetadataResponse200
    | PatchApiTracesByTraceIdMetadataResponse400
    | PatchApiTracesByTraceIdMetadataResponse401
    | PatchApiTracesByTraceIdMetadataResponse422
    | PatchApiTracesByTraceIdMetadataResponse500
]:
    """Update trace metadata

     Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes
    through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys
    are preserved. Labels replace entirely.

    Args:
        trace_id (str):
        body (PatchApiTracesByTraceIdMetadataBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiTracesByTraceIdMetadataResponse200 | PatchApiTracesByTraceIdMetadataResponse400 | PatchApiTracesByTraceIdMetadataResponse401 | PatchApiTracesByTraceIdMetadataResponse422 | PatchApiTracesByTraceIdMetadataResponse500]
    """

    kwargs = _get_kwargs(
        trace_id=trace_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    trace_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PatchApiTracesByTraceIdMetadataBody | Unset = UNSET,
) -> (
    PatchApiTracesByTraceIdMetadataResponse200
    | PatchApiTracesByTraceIdMetadataResponse400
    | PatchApiTracesByTraceIdMetadataResponse401
    | PatchApiTracesByTraceIdMetadataResponse422
    | PatchApiTracesByTraceIdMetadataResponse500
    | None
):
    """Update trace metadata

     Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes
    through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys
    are preserved. Labels replace entirely.

    Args:
        trace_id (str):
        body (PatchApiTracesByTraceIdMetadataBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiTracesByTraceIdMetadataResponse200 | PatchApiTracesByTraceIdMetadataResponse400 | PatchApiTracesByTraceIdMetadataResponse401 | PatchApiTracesByTraceIdMetadataResponse422 | PatchApiTracesByTraceIdMetadataResponse500
    """

    return (
        await asyncio_detailed(
            trace_id=trace_id,
            client=client,
            body=body,
        )
    ).parsed
