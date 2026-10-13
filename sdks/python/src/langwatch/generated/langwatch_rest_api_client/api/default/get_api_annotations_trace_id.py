from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_annotations_trace_id_anchor import GetApiAnnotationsTraceIdAnchor
from ...models.get_api_annotations_trace_id_response_200 import GetApiAnnotationsTraceIdResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    anchor: GetApiAnnotationsTraceIdAnchor | Unset = GetApiAnnotationsTraceIdAnchor.ALL,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_anchor: str | Unset = UNSET
    if not isinstance(anchor, Unset):
        json_anchor = anchor.value

    params["anchor"] = json_anchor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/annotations/trace/{id}".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiAnnotationsTraceIdResponse200 | None:
    if response.status_code == 200:
        response_200 = GetApiAnnotationsTraceIdResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiAnnotationsTraceIdResponse200]:
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
    id: str,
    *,
    client: AuthenticatedClient,
    anchor: GetApiAnnotationsTraceIdAnchor | Unset = GetApiAnnotationsTraceIdAnchor.ALL,
) -> Response[GetApiAnnotationsTraceIdResponse200]:
    """List annotations on a trace in the caller’s project

    Args:
        id (str):
        anchor (GetApiAnnotationsTraceIdAnchor | Unset):  Default:
            GetApiAnnotationsTraceIdAnchor.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiAnnotationsTraceIdResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        anchor=anchor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    anchor: GetApiAnnotationsTraceIdAnchor | Unset = GetApiAnnotationsTraceIdAnchor.ALL,
) -> GetApiAnnotationsTraceIdResponse200 | None:
    """List annotations on a trace in the caller’s project

    Args:
        id (str):
        anchor (GetApiAnnotationsTraceIdAnchor | Unset):  Default:
            GetApiAnnotationsTraceIdAnchor.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiAnnotationsTraceIdResponse200
    """

    return sync_detailed(
        id=id,
        client=client,
        anchor=anchor,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    anchor: GetApiAnnotationsTraceIdAnchor | Unset = GetApiAnnotationsTraceIdAnchor.ALL,
) -> Response[GetApiAnnotationsTraceIdResponse200]:
    """List annotations on a trace in the caller’s project

    Args:
        id (str):
        anchor (GetApiAnnotationsTraceIdAnchor | Unset):  Default:
            GetApiAnnotationsTraceIdAnchor.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiAnnotationsTraceIdResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        anchor=anchor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    anchor: GetApiAnnotationsTraceIdAnchor | Unset = GetApiAnnotationsTraceIdAnchor.ALL,
) -> GetApiAnnotationsTraceIdResponse200 | None:
    """List annotations on a trace in the caller’s project

    Args:
        id (str):
        anchor (GetApiAnnotationsTraceIdAnchor | Unset):  Default:
            GetApiAnnotationsTraceIdAnchor.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiAnnotationsTraceIdResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            anchor=anchor,
        )
    ).parsed
