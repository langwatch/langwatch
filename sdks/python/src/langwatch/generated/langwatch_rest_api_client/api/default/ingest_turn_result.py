from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.ingest_turn_result_body import IngestTurnResultBody
from ...models.ingest_turn_result_response_202 import IngestTurnResultResponse202
from ...types import Response, safe_http_status


def _get_kwargs(
    turn_id: str,
    *,
    body: IngestTurnResultBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/internal/langy/turn/{turn_id}/result".format(
            turn_id=quote(str(turn_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> IngestTurnResultResponse202 | None:
    if response.status_code == 202:
        response_202 = IngestTurnResultResponse202.from_dict(response.json())

        return response_202

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[IngestTurnResultResponse202]:
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
    turn_id: str,
    *,
    client: AuthenticatedClient,
    body: IngestTurnResultBody,
) -> Response[IngestTurnResultResponse202]:
    """
    Args:
        turn_id (str):
        body (IngestTurnResultBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[IngestTurnResultResponse202]
    """

    kwargs = _get_kwargs(
        turn_id=turn_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    turn_id: str,
    *,
    client: AuthenticatedClient,
    body: IngestTurnResultBody,
) -> IngestTurnResultResponse202 | None:
    """
    Args:
        turn_id (str):
        body (IngestTurnResultBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        IngestTurnResultResponse202
    """

    return sync_detailed(
        turn_id=turn_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    turn_id: str,
    *,
    client: AuthenticatedClient,
    body: IngestTurnResultBody,
) -> Response[IngestTurnResultResponse202]:
    """
    Args:
        turn_id (str):
        body (IngestTurnResultBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[IngestTurnResultResponse202]
    """

    kwargs = _get_kwargs(
        turn_id=turn_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    turn_id: str,
    *,
    client: AuthenticatedClient,
    body: IngestTurnResultBody,
) -> IngestTurnResultResponse202 | None:
    """
    Args:
        turn_id (str):
        body (IngestTurnResultBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        IngestTurnResultResponse202
    """

    return (
        await asyncio_detailed(
            turn_id=turn_id,
            client=client,
            body=body,
        )
    ).parsed
