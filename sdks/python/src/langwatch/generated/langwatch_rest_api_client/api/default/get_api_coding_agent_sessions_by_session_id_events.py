from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_coding_agent_sessions_by_session_id_events_response_200 import (
    GetApiCodingAgentSessionsBySessionIdEventsResponse200,
)
from ...models.get_api_coding_agent_sessions_by_session_id_events_response_400 import (
    GetApiCodingAgentSessionsBySessionIdEventsResponse400,
)
from ...models.get_api_coding_agent_sessions_by_session_id_events_response_401 import (
    GetApiCodingAgentSessionsBySessionIdEventsResponse401,
)
from ...models.get_api_coding_agent_sessions_by_session_id_events_response_422 import (
    GetApiCodingAgentSessionsBySessionIdEventsResponse422,
)
from ...models.get_api_coding_agent_sessions_by_session_id_events_response_500 import (
    GetApiCodingAgentSessionsBySessionIdEventsResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    session_id: str,
    *,
    limit: int | Unset = 500,
    kinds: str | Unset = UNSET,
    from_: float | Unset = UNSET,
    to: float | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["kinds"] = kinds

    params["from"] = from_

    params["to"] = to

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/coding-agent/sessions/{session_id}/events".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiCodingAgentSessionsBySessionIdEventsResponse200
    | GetApiCodingAgentSessionsBySessionIdEventsResponse400
    | GetApiCodingAgentSessionsBySessionIdEventsResponse401
    | GetApiCodingAgentSessionsBySessionIdEventsResponse422
    | GetApiCodingAgentSessionsBySessionIdEventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiCodingAgentSessionsBySessionIdEventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiCodingAgentSessionsBySessionIdEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiCodingAgentSessionsBySessionIdEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiCodingAgentSessionsBySessionIdEventsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiCodingAgentSessionsBySessionIdEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiCodingAgentSessionsBySessionIdEventsResponse200
    | GetApiCodingAgentSessionsBySessionIdEventsResponse400
    | GetApiCodingAgentSessionsBySessionIdEventsResponse401
    | GetApiCodingAgentSessionsBySessionIdEventsResponse422
    | GetApiCodingAgentSessionsBySessionIdEventsResponse500
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
    session_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    kinds: str | Unset = UNSET,
    from_: float | Unset = UNSET,
    to: float | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiCodingAgentSessionsBySessionIdEventsResponse200
    | GetApiCodingAgentSessionsBySessionIdEventsResponse400
    | GetApiCodingAgentSessionsBySessionIdEventsResponse401
    | GetApiCodingAgentSessionsBySessionIdEventsResponse422
    | GetApiCodingAgentSessionsBySessionIdEventsResponse500
]:
    """List coding agent session events

     List a coding-agent session's events (model calls, compactions, rate limits, tool runs, prompts) in
    time order, keyset-paginated. Pass the previous response's nextCursor to continue; filter with kinds
    (comma-separated).

    Args:
        session_id (str):
        limit (int | Unset):  Default: 500.
        kinds (str | Unset):
        from_ (float | Unset):
        to (float | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiCodingAgentSessionsBySessionIdEventsResponse200 | GetApiCodingAgentSessionsBySessionIdEventsResponse400 | GetApiCodingAgentSessionsBySessionIdEventsResponse401 | GetApiCodingAgentSessionsBySessionIdEventsResponse422 | GetApiCodingAgentSessionsBySessionIdEventsResponse500]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        limit=limit,
        kinds=kinds,
        from_=from_,
        to=to,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    kinds: str | Unset = UNSET,
    from_: float | Unset = UNSET,
    to: float | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> (
    GetApiCodingAgentSessionsBySessionIdEventsResponse200
    | GetApiCodingAgentSessionsBySessionIdEventsResponse400
    | GetApiCodingAgentSessionsBySessionIdEventsResponse401
    | GetApiCodingAgentSessionsBySessionIdEventsResponse422
    | GetApiCodingAgentSessionsBySessionIdEventsResponse500
    | None
):
    """List coding agent session events

     List a coding-agent session's events (model calls, compactions, rate limits, tool runs, prompts) in
    time order, keyset-paginated. Pass the previous response's nextCursor to continue; filter with kinds
    (comma-separated).

    Args:
        session_id (str):
        limit (int | Unset):  Default: 500.
        kinds (str | Unset):
        from_ (float | Unset):
        to (float | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiCodingAgentSessionsBySessionIdEventsResponse200 | GetApiCodingAgentSessionsBySessionIdEventsResponse400 | GetApiCodingAgentSessionsBySessionIdEventsResponse401 | GetApiCodingAgentSessionsBySessionIdEventsResponse422 | GetApiCodingAgentSessionsBySessionIdEventsResponse500
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        limit=limit,
        kinds=kinds,
        from_=from_,
        to=to,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    kinds: str | Unset = UNSET,
    from_: float | Unset = UNSET,
    to: float | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[
    GetApiCodingAgentSessionsBySessionIdEventsResponse200
    | GetApiCodingAgentSessionsBySessionIdEventsResponse400
    | GetApiCodingAgentSessionsBySessionIdEventsResponse401
    | GetApiCodingAgentSessionsBySessionIdEventsResponse422
    | GetApiCodingAgentSessionsBySessionIdEventsResponse500
]:
    """List coding agent session events

     List a coding-agent session's events (model calls, compactions, rate limits, tool runs, prompts) in
    time order, keyset-paginated. Pass the previous response's nextCursor to continue; filter with kinds
    (comma-separated).

    Args:
        session_id (str):
        limit (int | Unset):  Default: 500.
        kinds (str | Unset):
        from_ (float | Unset):
        to (float | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiCodingAgentSessionsBySessionIdEventsResponse200 | GetApiCodingAgentSessionsBySessionIdEventsResponse400 | GetApiCodingAgentSessionsBySessionIdEventsResponse401 | GetApiCodingAgentSessionsBySessionIdEventsResponse422 | GetApiCodingAgentSessionsBySessionIdEventsResponse500]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        limit=limit,
        kinds=kinds,
        from_=from_,
        to=to,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 500,
    kinds: str | Unset = UNSET,
    from_: float | Unset = UNSET,
    to: float | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> (
    GetApiCodingAgentSessionsBySessionIdEventsResponse200
    | GetApiCodingAgentSessionsBySessionIdEventsResponse400
    | GetApiCodingAgentSessionsBySessionIdEventsResponse401
    | GetApiCodingAgentSessionsBySessionIdEventsResponse422
    | GetApiCodingAgentSessionsBySessionIdEventsResponse500
    | None
):
    """List coding agent session events

     List a coding-agent session's events (model calls, compactions, rate limits, tool runs, prompts) in
    time order, keyset-paginated. Pass the previous response's nextCursor to continue; filter with kinds
    (comma-separated).

    Args:
        session_id (str):
        limit (int | Unset):  Default: 500.
        kinds (str | Unset):
        from_ (float | Unset):
        to (float | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiCodingAgentSessionsBySessionIdEventsResponse200 | GetApiCodingAgentSessionsBySessionIdEventsResponse400 | GetApiCodingAgentSessionsBySessionIdEventsResponse401 | GetApiCodingAgentSessionsBySessionIdEventsResponse422 | GetApiCodingAgentSessionsBySessionIdEventsResponse500
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            limit=limit,
            kinds=kinds,
            from_=from_,
            to=to,
            cursor=cursor,
        )
    ).parsed
