from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_runs_by_run_id_response_200 import GetApiExperimentsRunsByRunIdResponse200
from ...models.get_api_experiments_runs_by_run_id_response_401 import GetApiExperimentsRunsByRunIdResponse401
from ...models.get_api_experiments_runs_by_run_id_response_404 import GetApiExperimentsRunsByRunIdResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    run_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/experiments/runs/{run_id}".format(
            run_id=quote(str(run_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiExperimentsRunsByRunIdResponse200
    | GetApiExperimentsRunsByRunIdResponse401
    | GetApiExperimentsRunsByRunIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetApiExperimentsRunsByRunIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetApiExperimentsRunsByRunIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiExperimentsRunsByRunIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiExperimentsRunsByRunIdResponse200
    | GetApiExperimentsRunsByRunIdResponse401
    | GetApiExperimentsRunsByRunIdResponse404
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
) -> Response[
    GetApiExperimentsRunsByRunIdResponse200
    | GetApiExperimentsRunsByRunIdResponse401
    | GetApiExperimentsRunsByRunIdResponse404
]:
    """Poll a run

     Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI
    job can poll this until `status` leaves `running`.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsRunsByRunIdResponse200 | GetApiExperimentsRunsByRunIdResponse401 | GetApiExperimentsRunsByRunIdResponse404]
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
    client: AuthenticatedClient,
) -> (
    GetApiExperimentsRunsByRunIdResponse200
    | GetApiExperimentsRunsByRunIdResponse401
    | GetApiExperimentsRunsByRunIdResponse404
    | None
):
    """Poll a run

     Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI
    job can poll this until `status` leaves `running`.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsRunsByRunIdResponse200 | GetApiExperimentsRunsByRunIdResponse401 | GetApiExperimentsRunsByRunIdResponse404
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    run_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiExperimentsRunsByRunIdResponse200
    | GetApiExperimentsRunsByRunIdResponse401
    | GetApiExperimentsRunsByRunIdResponse404
]:
    """Poll a run

     Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI
    job can poll this until `status` leaves `running`.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsRunsByRunIdResponse200 | GetApiExperimentsRunsByRunIdResponse401 | GetApiExperimentsRunsByRunIdResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiExperimentsRunsByRunIdResponse200
    | GetApiExperimentsRunsByRunIdResponse401
    | GetApiExperimentsRunsByRunIdResponse404
    | None
):
    """Poll a run

     Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI
    job can poll this until `status` leaves `running`.

    Args:
        run_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsRunsByRunIdResponse200 | GetApiExperimentsRunsByRunIdResponse401 | GetApiExperimentsRunsByRunIdResponse404
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
        )
    ).parsed
