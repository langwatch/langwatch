from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_boards_by_board_id_body import PatchApiBoardsByBoardIdBody
from ...models.patch_api_boards_by_board_id_response_200 import PatchApiBoardsByBoardIdResponse200
from ...models.patch_api_boards_by_board_id_response_400 import PatchApiBoardsByBoardIdResponse400
from ...models.patch_api_boards_by_board_id_response_401 import PatchApiBoardsByBoardIdResponse401
from ...models.patch_api_boards_by_board_id_response_403 import PatchApiBoardsByBoardIdResponse403
from ...models.patch_api_boards_by_board_id_response_404 import PatchApiBoardsByBoardIdResponse404
from ...models.patch_api_boards_by_board_id_response_500 import PatchApiBoardsByBoardIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    board_id: str,
    *,
    body: PatchApiBoardsByBoardIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/boards/{board_id}".format(
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
    PatchApiBoardsByBoardIdResponse200
    | PatchApiBoardsByBoardIdResponse400
    | PatchApiBoardsByBoardIdResponse401
    | PatchApiBoardsByBoardIdResponse403
    | PatchApiBoardsByBoardIdResponse404
    | PatchApiBoardsByBoardIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiBoardsByBoardIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiBoardsByBoardIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiBoardsByBoardIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiBoardsByBoardIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PatchApiBoardsByBoardIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PatchApiBoardsByBoardIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiBoardsByBoardIdResponse200
    | PatchApiBoardsByBoardIdResponse400
    | PatchApiBoardsByBoardIdResponse401
    | PatchApiBoardsByBoardIdResponse403
    | PatchApiBoardsByBoardIdResponse404
    | PatchApiBoardsByBoardIdResponse500
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
    body: PatchApiBoardsByBoardIdBody,
) -> Response[
    PatchApiBoardsByBoardIdResponse200
    | PatchApiBoardsByBoardIdResponse400
    | PatchApiBoardsByBoardIdResponse401
    | PatchApiBoardsByBoardIdResponse403
    | PatchApiBoardsByBoardIdResponse404
    | PatchApiBoardsByBoardIdResponse500
]:
    """Update a board

     Changes a board's name or description; a field the body leaves out keeps its value, and a null
    description clears it.

    Args:
        board_id (str):
        body (PatchApiBoardsByBoardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiBoardsByBoardIdResponse200 | PatchApiBoardsByBoardIdResponse400 | PatchApiBoardsByBoardIdResponse401 | PatchApiBoardsByBoardIdResponse403 | PatchApiBoardsByBoardIdResponse404 | PatchApiBoardsByBoardIdResponse500]
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
    body: PatchApiBoardsByBoardIdBody,
) -> (
    PatchApiBoardsByBoardIdResponse200
    | PatchApiBoardsByBoardIdResponse400
    | PatchApiBoardsByBoardIdResponse401
    | PatchApiBoardsByBoardIdResponse403
    | PatchApiBoardsByBoardIdResponse404
    | PatchApiBoardsByBoardIdResponse500
    | None
):
    """Update a board

     Changes a board's name or description; a field the body leaves out keeps its value, and a null
    description clears it.

    Args:
        board_id (str):
        body (PatchApiBoardsByBoardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiBoardsByBoardIdResponse200 | PatchApiBoardsByBoardIdResponse400 | PatchApiBoardsByBoardIdResponse401 | PatchApiBoardsByBoardIdResponse403 | PatchApiBoardsByBoardIdResponse404 | PatchApiBoardsByBoardIdResponse500
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
    body: PatchApiBoardsByBoardIdBody,
) -> Response[
    PatchApiBoardsByBoardIdResponse200
    | PatchApiBoardsByBoardIdResponse400
    | PatchApiBoardsByBoardIdResponse401
    | PatchApiBoardsByBoardIdResponse403
    | PatchApiBoardsByBoardIdResponse404
    | PatchApiBoardsByBoardIdResponse500
]:
    """Update a board

     Changes a board's name or description; a field the body leaves out keeps its value, and a null
    description clears it.

    Args:
        board_id (str):
        body (PatchApiBoardsByBoardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiBoardsByBoardIdResponse200 | PatchApiBoardsByBoardIdResponse400 | PatchApiBoardsByBoardIdResponse401 | PatchApiBoardsByBoardIdResponse403 | PatchApiBoardsByBoardIdResponse404 | PatchApiBoardsByBoardIdResponse500]
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
    body: PatchApiBoardsByBoardIdBody,
) -> (
    PatchApiBoardsByBoardIdResponse200
    | PatchApiBoardsByBoardIdResponse400
    | PatchApiBoardsByBoardIdResponse401
    | PatchApiBoardsByBoardIdResponse403
    | PatchApiBoardsByBoardIdResponse404
    | PatchApiBoardsByBoardIdResponse500
    | None
):
    """Update a board

     Changes a board's name or description; a field the body leaves out keeps its value, and a null
    description clears it.

    Args:
        board_id (str):
        body (PatchApiBoardsByBoardIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiBoardsByBoardIdResponse200 | PatchApiBoardsByBoardIdResponse400 | PatchApiBoardsByBoardIdResponse401 | PatchApiBoardsByBoardIdResponse403 | PatchApiBoardsByBoardIdResponse404 | PatchApiBoardsByBoardIdResponse500
    """

    return (
        await asyncio_detailed(
            board_id=board_id,
            client=client,
            body=body,
        )
    ).parsed
