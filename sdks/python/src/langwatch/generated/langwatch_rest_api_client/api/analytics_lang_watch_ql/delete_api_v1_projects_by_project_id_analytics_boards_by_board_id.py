from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_200 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_400 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_401 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_403 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_404 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404,
)
from ...models.delete_api_v1_projects_by_project_id_analytics_boards_by_board_id_response_500 import (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    project_id: str,
    board_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/projects/{project_id}/analytics/boards/{board_id}".format(
            project_id=quote(str(project_id), safe=""),
            board_id=quote(str(board_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
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
    project_id: str,
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
]:
    """Delete a Dashboards board

     Deletes a board of the Dashboards area together with the widgets on it and every member's star of
    it; this cannot be undone. Answers with the deleted board's id and name. A board saved in another
    project, or one only Analytics Reports holds, is reported as not found.

    Args:
        project_id (str):
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        board_id=board_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    project_id: str,
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
    | None
):
    """Delete a Dashboards board

     Deletes a board of the Dashboards area together with the widgets on it and every member's star of
    it; this cannot be undone. Answers with the deleted board's id and name. A board saved in another
    project, or one only Analytics Reports holds, is reported as not found.

    Args:
        project_id (str):
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
    """

    return sync_detailed(
        project_id=project_id,
        board_id=board_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    project_id: str,
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
]:
    """Delete a Dashboards board

     Deletes a board of the Dashboards area together with the widgets on it and every member's star of
    it; this cannot be undone. Answers with the deleted board's id and name. A board saved in another
    project, or one only Analytics Reports holds, is reported as not found.

    Args:
        project_id (str):
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        board_id=board_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    project_id: str,
    board_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404
    | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
    | None
):
    """Delete a Dashboards board

     Deletes a board of the Dashboards area together with the widgets on it and every member's star of
    it; this cannot be undone. Answers with the deleted board's id and name. A board saved in another
    project, or one only Analytics Reports holds, is reported as not found.

    Args:
        project_id (str):
        board_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse200 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse400 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse401 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse403 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse404 | DeleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardIdResponse500
    """

    return (
        await asyncio_detailed(
            project_id=project_id,
            board_id=board_id,
            client=client,
        )
    ).parsed
