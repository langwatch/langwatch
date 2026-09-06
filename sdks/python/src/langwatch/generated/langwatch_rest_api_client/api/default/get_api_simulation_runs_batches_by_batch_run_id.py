from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_simulation_runs_batches_by_batch_run_id_response_200 import (
    GetApiSimulationRunsBatchesByBatchRunIdResponse200,
)
from ...models.get_api_simulation_runs_batches_by_batch_run_id_response_400 import (
    GetApiSimulationRunsBatchesByBatchRunIdResponse400,
)
from ...models.get_api_simulation_runs_batches_by_batch_run_id_response_401 import (
    GetApiSimulationRunsBatchesByBatchRunIdResponse401,
)
from ...models.get_api_simulation_runs_batches_by_batch_run_id_response_404 import (
    GetApiSimulationRunsBatchesByBatchRunIdResponse404,
)
from ...models.get_api_simulation_runs_batches_by_batch_run_id_response_422 import (
    GetApiSimulationRunsBatchesByBatchRunIdResponse422,
)
from ...models.get_api_simulation_runs_batches_by_batch_run_id_response_500 import (
    GetApiSimulationRunsBatchesByBatchRunIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    batch_run_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/simulation-runs/batches/{batch_run_id}".format(
            batch_run_id=quote(str(batch_run_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSimulationRunsBatchesByBatchRunIdResponse200
    | GetApiSimulationRunsBatchesByBatchRunIdResponse400
    | GetApiSimulationRunsBatchesByBatchRunIdResponse401
    | GetApiSimulationRunsBatchesByBatchRunIdResponse404
    | GetApiSimulationRunsBatchesByBatchRunIdResponse422
    | GetApiSimulationRunsBatchesByBatchRunIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiSimulationRunsBatchesByBatchRunIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSimulationRunsBatchesByBatchRunIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSimulationRunsBatchesByBatchRunIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiSimulationRunsBatchesByBatchRunIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiSimulationRunsBatchesByBatchRunIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSimulationRunsBatchesByBatchRunIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSimulationRunsBatchesByBatchRunIdResponse200
    | GetApiSimulationRunsBatchesByBatchRunIdResponse400
    | GetApiSimulationRunsBatchesByBatchRunIdResponse401
    | GetApiSimulationRunsBatchesByBatchRunIdResponse404
    | GetApiSimulationRunsBatchesByBatchRunIdResponse422
    | GetApiSimulationRunsBatchesByBatchRunIdResponse500
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
    batch_run_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiSimulationRunsBatchesByBatchRunIdResponse200
    | GetApiSimulationRunsBatchesByBatchRunIdResponse400
    | GetApiSimulationRunsBatchesByBatchRunIdResponse401
    | GetApiSimulationRunsBatchesByBatchRunIdResponse404
    | GetApiSimulationRunsBatchesByBatchRunIdResponse422
    | GetApiSimulationRunsBatchesByBatchRunIdResponse500
]:
    """Get the summary of a single batch run, including its completion flag

    Args:
        batch_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsBatchesByBatchRunIdResponse200 | GetApiSimulationRunsBatchesByBatchRunIdResponse400 | GetApiSimulationRunsBatchesByBatchRunIdResponse401 | GetApiSimulationRunsBatchesByBatchRunIdResponse404 | GetApiSimulationRunsBatchesByBatchRunIdResponse422 | GetApiSimulationRunsBatchesByBatchRunIdResponse500]
    """

    kwargs = _get_kwargs(
        batch_run_id=batch_run_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    batch_run_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiSimulationRunsBatchesByBatchRunIdResponse200
    | GetApiSimulationRunsBatchesByBatchRunIdResponse400
    | GetApiSimulationRunsBatchesByBatchRunIdResponse401
    | GetApiSimulationRunsBatchesByBatchRunIdResponse404
    | GetApiSimulationRunsBatchesByBatchRunIdResponse422
    | GetApiSimulationRunsBatchesByBatchRunIdResponse500
    | None
):
    """Get the summary of a single batch run, including its completion flag

    Args:
        batch_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsBatchesByBatchRunIdResponse200 | GetApiSimulationRunsBatchesByBatchRunIdResponse400 | GetApiSimulationRunsBatchesByBatchRunIdResponse401 | GetApiSimulationRunsBatchesByBatchRunIdResponse404 | GetApiSimulationRunsBatchesByBatchRunIdResponse422 | GetApiSimulationRunsBatchesByBatchRunIdResponse500
    """

    return sync_detailed(
        batch_run_id=batch_run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    batch_run_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiSimulationRunsBatchesByBatchRunIdResponse200
    | GetApiSimulationRunsBatchesByBatchRunIdResponse400
    | GetApiSimulationRunsBatchesByBatchRunIdResponse401
    | GetApiSimulationRunsBatchesByBatchRunIdResponse404
    | GetApiSimulationRunsBatchesByBatchRunIdResponse422
    | GetApiSimulationRunsBatchesByBatchRunIdResponse500
]:
    """Get the summary of a single batch run, including its completion flag

    Args:
        batch_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSimulationRunsBatchesByBatchRunIdResponse200 | GetApiSimulationRunsBatchesByBatchRunIdResponse400 | GetApiSimulationRunsBatchesByBatchRunIdResponse401 | GetApiSimulationRunsBatchesByBatchRunIdResponse404 | GetApiSimulationRunsBatchesByBatchRunIdResponse422 | GetApiSimulationRunsBatchesByBatchRunIdResponse500]
    """

    kwargs = _get_kwargs(
        batch_run_id=batch_run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    batch_run_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiSimulationRunsBatchesByBatchRunIdResponse200
    | GetApiSimulationRunsBatchesByBatchRunIdResponse400
    | GetApiSimulationRunsBatchesByBatchRunIdResponse401
    | GetApiSimulationRunsBatchesByBatchRunIdResponse404
    | GetApiSimulationRunsBatchesByBatchRunIdResponse422
    | GetApiSimulationRunsBatchesByBatchRunIdResponse500
    | None
):
    """Get the summary of a single batch run, including its completion flag

    Args:
        batch_run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSimulationRunsBatchesByBatchRunIdResponse200 | GetApiSimulationRunsBatchesByBatchRunIdResponse400 | GetApiSimulationRunsBatchesByBatchRunIdResponse401 | GetApiSimulationRunsBatchesByBatchRunIdResponse404 | GetApiSimulationRunsBatchesByBatchRunIdResponse422 | GetApiSimulationRunsBatchesByBatchRunIdResponse500
    """

    return (
        await asyncio_detailed(
            batch_run_id=batch_run_id,
            client=client,
        )
    ).parsed
