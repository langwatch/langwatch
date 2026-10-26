from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_boards_by_board_id_widgets_body import PostApiBoardsByBoardIdWidgetsBody
from ...models.post_api_boards_by_board_id_widgets_response_201 import PostApiBoardsByBoardIdWidgetsResponse201
from ...models.post_api_boards_by_board_id_widgets_response_400 import PostApiBoardsByBoardIdWidgetsResponse400
from ...models.post_api_boards_by_board_id_widgets_response_401 import PostApiBoardsByBoardIdWidgetsResponse401
from ...models.post_api_boards_by_board_id_widgets_response_403 import PostApiBoardsByBoardIdWidgetsResponse403
from ...models.post_api_boards_by_board_id_widgets_response_404 import PostApiBoardsByBoardIdWidgetsResponse404
from ...models.post_api_boards_by_board_id_widgets_response_500 import PostApiBoardsByBoardIdWidgetsResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    board_id: str,
    *,
    body: PostApiBoardsByBoardIdWidgetsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/boards/{board_id}/widgets".format(
            board_id=quote(str(board_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiBoardsByBoardIdWidgetsResponse201
    | PostApiBoardsByBoardIdWidgetsResponse400
    | PostApiBoardsByBoardIdWidgetsResponse401
    | PostApiBoardsByBoardIdWidgetsResponse403
    | PostApiBoardsByBoardIdWidgetsResponse404
    | PostApiBoardsByBoardIdWidgetsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiBoardsByBoardIdWidgetsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiBoardsByBoardIdWidgetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiBoardsByBoardIdWidgetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiBoardsByBoardIdWidgetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiBoardsByBoardIdWidgetsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PostApiBoardsByBoardIdWidgetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiBoardsByBoardIdWidgetsResponse201
    | PostApiBoardsByBoardIdWidgetsResponse400
    | PostApiBoardsByBoardIdWidgetsResponse401
    | PostApiBoardsByBoardIdWidgetsResponse403
    | PostApiBoardsByBoardIdWidgetsResponse404
    | PostApiBoardsByBoardIdWidgetsResponse500
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
    body: PostApiBoardsByBoardIdWidgetsBody,
) -> Response[
    PostApiBoardsByBoardIdWidgetsResponse201
    | PostApiBoardsByBoardIdWidgetsResponse400
    | PostApiBoardsByBoardIdWidgetsResponse401
    | PostApiBoardsByBoardIdWidgetsResponse403
    | PostApiBoardsByBoardIdWidgetsResponse404
    | PostApiBoardsByBoardIdWidgetsResponse500
]:
    """Create a widget on a board

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    board at the next free row. `source` records where the widget came from; without it, the widget is
    recorded as made through the API.

    Args:
        board_id (str):
        body (PostApiBoardsByBoardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiBoardsByBoardIdWidgetsResponse201 | PostApiBoardsByBoardIdWidgetsResponse400 | PostApiBoardsByBoardIdWidgetsResponse401 | PostApiBoardsByBoardIdWidgetsResponse403 | PostApiBoardsByBoardIdWidgetsResponse404 | PostApiBoardsByBoardIdWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        board_id=board_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    board_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiBoardsByBoardIdWidgetsBody,
) -> (
    PostApiBoardsByBoardIdWidgetsResponse201
    | PostApiBoardsByBoardIdWidgetsResponse400
    | PostApiBoardsByBoardIdWidgetsResponse401
    | PostApiBoardsByBoardIdWidgetsResponse403
    | PostApiBoardsByBoardIdWidgetsResponse404
    | PostApiBoardsByBoardIdWidgetsResponse500
    | None
):
    """Create a widget on a board

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    board at the next free row. `source` records where the widget came from; without it, the widget is
    recorded as made through the API.

    Args:
        board_id (str):
        body (PostApiBoardsByBoardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiBoardsByBoardIdWidgetsResponse201 | PostApiBoardsByBoardIdWidgetsResponse400 | PostApiBoardsByBoardIdWidgetsResponse401 | PostApiBoardsByBoardIdWidgetsResponse403 | PostApiBoardsByBoardIdWidgetsResponse404 | PostApiBoardsByBoardIdWidgetsResponse500
    """

    return sync_detailed(
        board_id=board_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    board_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiBoardsByBoardIdWidgetsBody,
) -> Response[
    PostApiBoardsByBoardIdWidgetsResponse201
    | PostApiBoardsByBoardIdWidgetsResponse400
    | PostApiBoardsByBoardIdWidgetsResponse401
    | PostApiBoardsByBoardIdWidgetsResponse403
    | PostApiBoardsByBoardIdWidgetsResponse404
    | PostApiBoardsByBoardIdWidgetsResponse500
]:
    """Create a widget on a board

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    board at the next free row. `source` records where the widget came from; without it, the widget is
    recorded as made through the API.

    Args:
        board_id (str):
        body (PostApiBoardsByBoardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiBoardsByBoardIdWidgetsResponse201 | PostApiBoardsByBoardIdWidgetsResponse400 | PostApiBoardsByBoardIdWidgetsResponse401 | PostApiBoardsByBoardIdWidgetsResponse403 | PostApiBoardsByBoardIdWidgetsResponse404 | PostApiBoardsByBoardIdWidgetsResponse500]
    """

    kwargs = _get_kwargs(
        board_id=board_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    board_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiBoardsByBoardIdWidgetsBody,
) -> (
    PostApiBoardsByBoardIdWidgetsResponse201
    | PostApiBoardsByBoardIdWidgetsResponse400
    | PostApiBoardsByBoardIdWidgetsResponse401
    | PostApiBoardsByBoardIdWidgetsResponse403
    | PostApiBoardsByBoardIdWidgetsResponse404
    | PostApiBoardsByBoardIdWidgetsResponse500
    | None
):
    """Create a widget on a board

     Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this
    board at the next free row. `source` records where the widget came from; without it, the widget is
    recorded as made through the API.

    Args:
        board_id (str):
        body (PostApiBoardsByBoardIdWidgetsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiBoardsByBoardIdWidgetsResponse201 | PostApiBoardsByBoardIdWidgetsResponse400 | PostApiBoardsByBoardIdWidgetsResponse401 | PostApiBoardsByBoardIdWidgetsResponse403 | PostApiBoardsByBoardIdWidgetsResponse404 | PostApiBoardsByBoardIdWidgetsResponse500
    """

    return (
        await asyncio_detailed(
            board_id=board_id,
            client=client,
            body=body,
        )
    ).parsed
