from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_boards_by_board_id_response_200 import DeleteApiBoardsByBoardIdResponse200
from ...models.delete_api_boards_by_board_id_response_400 import DeleteApiBoardsByBoardIdResponse400
from ...models.delete_api_boards_by_board_id_response_401 import DeleteApiBoardsByBoardIdResponse401
from ...models.delete_api_boards_by_board_id_response_403 import DeleteApiBoardsByBoardIdResponse403
from ...models.delete_api_boards_by_board_id_response_404 import DeleteApiBoardsByBoardIdResponse404
from ...models.delete_api_boards_by_board_id_response_500 import DeleteApiBoardsByBoardIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    board_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/boards/{board_id}".format(
            board_id=quote(str(board_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiBoardsByBoardIdResponse200
    | DeleteApiBoardsByBoardIdResponse400
    | DeleteApiBoardsByBoardIdResponse401
    | DeleteApiBoardsByBoardIdResponse403
    | DeleteApiBoardsByBoardIdResponse404
    | DeleteApiBoardsByBoardIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiBoardsByBoardIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiBoardsByBoardIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiBoardsByBoardIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiBoardsByBoardIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = DeleteApiBoardsByBoardIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = DeleteApiBoardsByBoardIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiBoardsByBoardIdResponse200
    | DeleteApiBoardsByBoardIdResponse400
    | DeleteApiBoardsByBoardIdResponse401
    | DeleteApiBoardsByBoardIdResponse403
    | DeleteApiBoardsByBoardIdResponse404
    | DeleteApiBoardsByBoardIdResponse500
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
    DeleteApiBoardsByBoardIdResponse200
    | DeleteApiBoardsByBoardIdResponse400
    | DeleteApiBoardsByBoardIdResponse401
    | DeleteApiBoardsByBoardIdResponse403
    | DeleteApiBoardsByBoardIdResponse404
    | DeleteApiBoardsByBoardIdResponse500
]:
    """Delete a board

     Deletes a board together with the widgets on it and every member's star of it; this cannot be
    undone. Answers with the deleted board's id and name.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiBoardsByBoardIdResponse200 | DeleteApiBoardsByBoardIdResponse400 | DeleteApiBoardsByBoardIdResponse401 | DeleteApiBoardsByBoardIdResponse403 | DeleteApiBoardsByBoardIdResponse404 | DeleteApiBoardsByBoardIdResponse500]
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
    DeleteApiBoardsByBoardIdResponse200
    | DeleteApiBoardsByBoardIdResponse400
    | DeleteApiBoardsByBoardIdResponse401
    | DeleteApiBoardsByBoardIdResponse403
    | DeleteApiBoardsByBoardIdResponse404
    | DeleteApiBoardsByBoardIdResponse500
    | None
):
    """Delete a board

     Deletes a board together with the widgets on it and every member's star of it; this cannot be
    undone. Answers with the deleted board's id and name.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiBoardsByBoardIdResponse200 | DeleteApiBoardsByBoardIdResponse400 | DeleteApiBoardsByBoardIdResponse401 | DeleteApiBoardsByBoardIdResponse403 | DeleteApiBoardsByBoardIdResponse404 | DeleteApiBoardsByBoardIdResponse500
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
    DeleteApiBoardsByBoardIdResponse200
    | DeleteApiBoardsByBoardIdResponse400
    | DeleteApiBoardsByBoardIdResponse401
    | DeleteApiBoardsByBoardIdResponse403
    | DeleteApiBoardsByBoardIdResponse404
    | DeleteApiBoardsByBoardIdResponse500
]:
    """Delete a board

     Deletes a board together with the widgets on it and every member's star of it; this cannot be
    undone. Answers with the deleted board's id and name.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiBoardsByBoardIdResponse200 | DeleteApiBoardsByBoardIdResponse400 | DeleteApiBoardsByBoardIdResponse401 | DeleteApiBoardsByBoardIdResponse403 | DeleteApiBoardsByBoardIdResponse404 | DeleteApiBoardsByBoardIdResponse500]
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
    DeleteApiBoardsByBoardIdResponse200
    | DeleteApiBoardsByBoardIdResponse400
    | DeleteApiBoardsByBoardIdResponse401
    | DeleteApiBoardsByBoardIdResponse403
    | DeleteApiBoardsByBoardIdResponse404
    | DeleteApiBoardsByBoardIdResponse500
    | None
):
    """Delete a board

     Deletes a board together with the widgets on it and every member's star of it; this cannot be
    undone. Answers with the deleted board's id and name.

    Args:
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiBoardsByBoardIdResponse200 | DeleteApiBoardsByBoardIdResponse400 | DeleteApiBoardsByBoardIdResponse401 | DeleteApiBoardsByBoardIdResponse403 | DeleteApiBoardsByBoardIdResponse404 | DeleteApiBoardsByBoardIdResponse500
    """

    return (
        await asyncio_detailed(
            board_id=board_id,
            client=client,
        )
    ).parsed
