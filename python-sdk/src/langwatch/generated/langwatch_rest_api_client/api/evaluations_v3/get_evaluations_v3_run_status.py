from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_evaluations_v3_run_status_response_200 import GetEvaluationsV3RunStatusResponse200
from ...models.get_evaluations_v3_run_status_response_401 import GetEvaluationsV3RunStatusResponse401
from ...models.get_evaluations_v3_run_status_response_404 import GetEvaluationsV3RunStatusResponse404
from ...types import Response


def _get_kwargs(
    run_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/evaluations/v3/runs/{run_id}".format(
            run_id=quote(str(run_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetEvaluationsV3RunStatusResponse200
    | GetEvaluationsV3RunStatusResponse401
    | GetEvaluationsV3RunStatusResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetEvaluationsV3RunStatusResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetEvaluationsV3RunStatusResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetEvaluationsV3RunStatusResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404
]:
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetEvaluationsV3RunStatusResponse200
    | GetEvaluationsV3RunStatusResponse401
    | GetEvaluationsV3RunStatusResponse404
    | None
):
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404
]:
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetEvaluationsV3RunStatusResponse200
    | GetEvaluationsV3RunStatusResponse401
    | GetEvaluationsV3RunStatusResponse404
    | None
):
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetEvaluationsV3RunStatusResponse200 | GetEvaluationsV3RunStatusResponse401 | GetEvaluationsV3RunStatusResponse404
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
        )
    ).parsed
