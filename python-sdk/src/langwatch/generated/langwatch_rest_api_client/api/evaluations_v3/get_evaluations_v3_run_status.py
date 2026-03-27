from http import HTTPStatus
from typing import Any, Optional, Union

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
        "url": f"/api/evaluations/v3/runs/{run_id}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404
    ]
]:
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
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404
    ]
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
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404
    ]
]:
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404]]
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
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404
    ]
]:
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404]
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    run_id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404
    ]
]:
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404]]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404
    ]
]:
    """Get the current status of an evaluation run for polling. Returns progress while running, and summary
    when completed.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetEvaluationsV3RunStatusResponse200, GetEvaluationsV3RunStatusResponse401, GetEvaluationsV3RunStatusResponse404]
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
        )
    ).parsed
