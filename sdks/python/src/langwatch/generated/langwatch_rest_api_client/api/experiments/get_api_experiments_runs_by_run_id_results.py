from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_runs_by_run_id_results_response_200 import (
    GetApiExperimentsRunsByRunIdResultsResponse200,
)
from ...models.get_api_experiments_runs_by_run_id_results_response_401 import (
    GetApiExperimentsRunsByRunIdResultsResponse401,
)
from ...models.get_api_experiments_runs_by_run_id_results_response_404 import (
    GetApiExperimentsRunsByRunIdResultsResponse404,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    run_id: str,
    *,
    experiment_slug: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["experimentSlug"] = experiment_slug

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/experiments/runs/{run_id}/results".format(
            run_id=quote(str(run_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiExperimentsRunsByRunIdResultsResponse200
    | GetApiExperimentsRunsByRunIdResultsResponse401
    | GetApiExperimentsRunsByRunIdResultsResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetApiExperimentsRunsByRunIdResultsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetApiExperimentsRunsByRunIdResultsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiExperimentsRunsByRunIdResultsResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiExperimentsRunsByRunIdResultsResponse200
    | GetApiExperimentsRunsByRunIdResultsResponse401
    | GetApiExperimentsRunsByRunIdResultsResponse404
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
    run_id: str,
    *,
    client: AuthenticatedClient,
    experiment_slug: str | Unset = UNSET,
) -> Response[
    GetApiExperimentsRunsByRunIdResultsResponse200
    | GetApiExperimentsRunsByRunIdResultsResponse401
    | GetApiExperimentsRunsByRunIdResultsResponse404
]:
    """Read run results

     Every dataset row of a run with what the target predicted, plus one entry per evaluator per row.
    Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within
    its experiment.

    Args:
        run_id (str):
        experiment_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsRunsByRunIdResultsResponse200 | GetApiExperimentsRunsByRunIdResultsResponse401 | GetApiExperimentsRunsByRunIdResultsResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
        experiment_slug=experiment_slug,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    run_id: str,
    *,
    client: AuthenticatedClient,
    experiment_slug: str | Unset = UNSET,
) -> (
    GetApiExperimentsRunsByRunIdResultsResponse200
    | GetApiExperimentsRunsByRunIdResultsResponse401
    | GetApiExperimentsRunsByRunIdResultsResponse404
    | None
):
    """Read run results

     Every dataset row of a run with what the target predicted, plus one entry per evaluator per row.
    Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within
    its experiment.

    Args:
        run_id (str):
        experiment_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsRunsByRunIdResultsResponse200 | GetApiExperimentsRunsByRunIdResultsResponse401 | GetApiExperimentsRunsByRunIdResultsResponse404
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
        experiment_slug=experiment_slug,
    ).parsed


async def asyncio_detailed(
    run_id: str,
    *,
    client: AuthenticatedClient,
    experiment_slug: str | Unset = UNSET,
) -> Response[
    GetApiExperimentsRunsByRunIdResultsResponse200
    | GetApiExperimentsRunsByRunIdResultsResponse401
    | GetApiExperimentsRunsByRunIdResultsResponse404
]:
    """Read run results

     Every dataset row of a run with what the target predicted, plus one entry per evaluator per row.
    Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within
    its experiment.

    Args:
        run_id (str):
        experiment_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsRunsByRunIdResultsResponse200 | GetApiExperimentsRunsByRunIdResultsResponse401 | GetApiExperimentsRunsByRunIdResultsResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
        experiment_slug=experiment_slug,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: str,
    *,
    client: AuthenticatedClient,
    experiment_slug: str | Unset = UNSET,
) -> (
    GetApiExperimentsRunsByRunIdResultsResponse200
    | GetApiExperimentsRunsByRunIdResultsResponse401
    | GetApiExperimentsRunsByRunIdResultsResponse404
    | None
):
    """Read run results

     Every dataset row of a run with what the target predicted, plus one entry per evaluator per row.
    Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within
    its experiment.

    Args:
        run_id (str):
        experiment_slug (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsRunsByRunIdResultsResponse200 | GetApiExperimentsRunsByRunIdResultsResponse401 | GetApiExperimentsRunsByRunIdResultsResponse404
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
            experiment_slug=experiment_slug,
        )
    ).parsed
