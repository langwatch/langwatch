from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_boards_by_board_id_widgets_response_200 import GetApiBoardsByBoardIdWidgetsResponse200
from ...models.get_api_boards_by_board_id_widgets_response_400 import GetApiBoardsByBoardIdWidgetsResponse400
from ...models.get_api_boards_by_board_id_widgets_response_401 import GetApiBoardsByBoardIdWidgetsResponse401
from ...models.get_api_boards_by_board_id_widgets_response_403 import GetApiBoardsByBoardIdWidgetsResponse403
from ...models.get_api_boards_by_board_id_widgets_response_404 import GetApiBoardsByBoardIdWidgetsResponse404
from ...models.get_api_boards_by_board_id_widgets_response_500 import GetApiBoardsByBoardIdWidgetsResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    board_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/boards/{board_id}/widgets".format(
            board_id=quote(str(board_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiBoardsByBoardIdWidgetsResponse200
    | GetApiBoardsByBoardIdWidgetsResponse400
    | GetApiBoardsByBoardIdWidgetsResponse401
    | GetApiBoardsByBoardIdWidgetsResponse403
    | GetApiBoardsByBoardIdWidgetsResponse404
    | GetApiBoardsByBoardIdWidgetsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiBoardsByBoardIdWidgetsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiBoardsByBoardIdWidgetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiBoardsByBoardIdWidgetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiBoardsByBoardIdWidgetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiBoardsByBoardIdWidgetsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetApiBoardsByBoardIdWidgetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiBoardsByBoardIdWidgetsResponse200
    | GetApiBoardsByBoardIdWidgetsResponse400
    | GetApiBoardsByBoardIdWidgetsResponse401
    | GetApiBoardsByBoardIdWidgetsResponse403
    | GetApiBoardsByBoardIdWidgetsResponse404
    | GetApiBoardsByBoardIdWidgetsResponse500
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
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiBoardsByBoardIdWidgetsResponse200
    | GetApiBoardsByBoardIdWidgetsResponse400
    | GetApiBoardsByBoardIdWidgetsResponse401
    | GetApiBoardsByBoardIdWidgetsResponse403
    | GetApiBoardsByBoardIdWidgetsResponse404
    | GetApiBoardsByBoardIdWidgetsResponse500
]:
    """List a board's widgets

     Lists the widgets on one board, each with its React source and named queries.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiBoardsByBoardIdWidgetsResponse200 | GetApiBoardsByBoardIdWidgetsResponse400 | GetApiBoardsByBoardIdWidgetsResponse401 | GetApiBoardsByBoardIdWidgetsResponse403 | GetApiBoardsByBoardIdWidgetsResponse404 | GetApiBoardsByBoardIdWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        board_id=board_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiBoardsByBoardIdWidgetsResponse200
    | GetApiBoardsByBoardIdWidgetsResponse400
    | GetApiBoardsByBoardIdWidgetsResponse401
    | GetApiBoardsByBoardIdWidgetsResponse403
    | GetApiBoardsByBoardIdWidgetsResponse404
    | GetApiBoardsByBoardIdWidgetsResponse500
    | None
):
    """List a board's widgets

     Lists the widgets on one board, each with its React source and named queries.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiBoardsByBoardIdWidgetsResponse200 | GetApiBoardsByBoardIdWidgetsResponse400 | GetApiBoardsByBoardIdWidgetsResponse401 | GetApiBoardsByBoardIdWidgetsResponse403 | GetApiBoardsByBoardIdWidgetsResponse404 | GetApiBoardsByBoardIdWidgetsResponse500
    """

    return sync_detailed(
        board_id=board_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiBoardsByBoardIdWidgetsResponse200
    | GetApiBoardsByBoardIdWidgetsResponse400
    | GetApiBoardsByBoardIdWidgetsResponse401
    | GetApiBoardsByBoardIdWidgetsResponse403
    | GetApiBoardsByBoardIdWidgetsResponse404
    | GetApiBoardsByBoardIdWidgetsResponse500
]:
    """List a board's widgets

     Lists the widgets on one board, each with its React source and named queries.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiBoardsByBoardIdWidgetsResponse200 | GetApiBoardsByBoardIdWidgetsResponse400 | GetApiBoardsByBoardIdWidgetsResponse401 | GetApiBoardsByBoardIdWidgetsResponse403 | GetApiBoardsByBoardIdWidgetsResponse404 | GetApiBoardsByBoardIdWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        board_id=board_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiBoardsByBoardIdWidgetsResponse200
    | GetApiBoardsByBoardIdWidgetsResponse400
    | GetApiBoardsByBoardIdWidgetsResponse401
    | GetApiBoardsByBoardIdWidgetsResponse403
    | GetApiBoardsByBoardIdWidgetsResponse404
    | GetApiBoardsByBoardIdWidgetsResponse500
    | None
):
    """List a board's widgets

     Lists the widgets on one board, each with its React source and named queries.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiBoardsByBoardIdWidgetsResponse200 | GetApiBoardsByBoardIdWidgetsResponse400 | GetApiBoardsByBoardIdWidgetsResponse401 | GetApiBoardsByBoardIdWidgetsResponse403 | GetApiBoardsByBoardIdWidgetsResponse404 | GetApiBoardsByBoardIdWidgetsResponse500
    """

    return (
        await asyncio_detailed(
            board_id=board_id,
            client=client,
        )
    ).parsed
