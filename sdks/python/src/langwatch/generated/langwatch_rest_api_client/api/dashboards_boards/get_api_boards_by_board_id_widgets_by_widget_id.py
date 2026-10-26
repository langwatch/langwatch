from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_boards_by_board_id_widgets_by_widget_id_response_200 import (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200,
)
from ...models.get_api_boards_by_board_id_widgets_by_widget_id_response_400 import (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400,
)
from ...models.get_api_boards_by_board_id_widgets_by_widget_id_response_401 import (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401,
)
from ...models.get_api_boards_by_board_id_widgets_by_widget_id_response_403 import (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403,
)
from ...models.get_api_boards_by_board_id_widgets_by_widget_id_response_404 import (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404,
)
from ...models.get_api_boards_by_board_id_widgets_by_widget_id_response_500 import (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    board_id: str,
    widget_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/boards/{board_id}/widgets/{widget_id}".format(
            board_id=quote(str(board_id), safe=""),
            widget_id=quote(str(widget_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
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
    widget_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
]:
    """Get a widget on a board

     Returns one widget on this board with its React source and named queries.

    Args:
        board_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        board_id=board_id,
        widget_id=widget_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    board_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
    | None
):
    """Get a widget on a board

     Returns one widget on this board with its React source and named queries.

    Args:
        board_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
    """

    return sync_detailed(
        board_id=board_id,
        widget_id=widget_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    board_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
]:
    """Get a widget on a board

     Returns one widget on this board with its React source and named queries.

    Args:
        board_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500]
    """

    kwargs = _get_kwargs(
        board_id=board_id,
        widget_id=widget_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    board_id: str,
    widget_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404
    | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
    | None
):
    """Get a widget on a board

     Returns one widget on this board with its React source and named queries.

    Args:
        board_id (str):
        widget_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiBoardsByBoardIdWidgetsByWidgetIdResponse200 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse400 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse401 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse403 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse404 | GetApiBoardsByBoardIdWidgetsByWidgetIdResponse500
    """

    return (
        await asyncio_detailed(
            board_id=board_id,
            widget_id=widget_id,
            client=client,
        )
    ).parsed
