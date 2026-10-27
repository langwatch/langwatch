from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_triggers_by_id_fires_response_200 import GetApiTriggersByIdFiresResponse200
from ...models.get_api_triggers_by_id_fires_response_404 import GetApiTriggersByIdFiresResponse404
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    trigger_id: str,
    *,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/triggers/{trigger_id}/fires".format(
            trigger_id=quote(str(trigger_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404 | None:
    if response.status_code == 200:
        response_200 = GetApiTriggersByIdFiresResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetApiTriggersByIdFiresResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404]:
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
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> Response[GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404]:
    """What this automation has done: its fires, newest first. Metadata only (no trace ids and no trace
    content). Send `nextCursor` back as `cursor` to read the page after this one.

    Args:
        trigger_id (str):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404 | None:
    """What this automation has done: its fires, newest first. Metadata only (no trace ids and no trace
    content). Send `nextCursor` back as `cursor` to read the page after this one.

    Args:
        trigger_id (str):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404
    """

    return sync_detailed(
        trigger_id=trigger_id,
        client=client,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> Response[GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404]:
    """What this automation has done: its fires, newest first. Metadata only (no trace ids and no trace
    content). Send `nextCursor` back as `cursor` to read the page after this one.

    Args:
        trigger_id (str):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404 | None:
    """What this automation has done: its fires, newest first. Metadata only (no trace ids and no trace
    content). Send `nextCursor` back as `cursor` to read the page after this one.

    Args:
        trigger_id (str):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTriggersByIdFiresResponse200 | GetApiTriggersByIdFiresResponse404
    """

    return (
        await asyncio_detailed(
            trigger_id=trigger_id,
            client=client,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
