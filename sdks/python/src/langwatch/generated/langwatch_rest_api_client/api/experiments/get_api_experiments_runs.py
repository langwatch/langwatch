from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_runs_response_200 import GetApiExperimentsRunsResponse200
from ...models.get_api_experiments_runs_response_400 import GetApiExperimentsRunsResponse400
from ...models.get_api_experiments_runs_response_401 import GetApiExperimentsRunsResponse401
from ...models.get_api_experiments_runs_response_404 import GetApiExperimentsRunsResponse404
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    experiment_slug: str,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["experimentSlug"] = experiment_slug

    params["page"] = page

    params["pageSize"] = page_size

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/experiments/runs",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiExperimentsRunsResponse200
    | GetApiExperimentsRunsResponse400
    | GetApiExperimentsRunsResponse401
    | GetApiExperimentsRunsResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetApiExperimentsRunsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiExperimentsRunsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiExperimentsRunsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiExperimentsRunsResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiExperimentsRunsResponse200
    | GetApiExperimentsRunsResponse400
    | GetApiExperimentsRunsResponse401
    | GetApiExperimentsRunsResponse404
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
    *,
    client: AuthenticatedClient,
    experiment_slug: str,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> Response[
    GetApiExperimentsRunsResponse200
    | GetApiExperimentsRunsResponse400
    | GetApiExperimentsRunsResponse401
    | GetApiExperimentsRunsResponse404
]:
    """List runs of an experiment

     Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.

    Args:
        experiment_slug (str):
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsRunsResponse200 | GetApiExperimentsRunsResponse400 | GetApiExperimentsRunsResponse401 | GetApiExperimentsRunsResponse404]
    """

    kwargs = _get_kwargs(
        experiment_slug=experiment_slug,
        page=page,
        page_size=page_size,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    experiment_slug: str,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> (
    GetApiExperimentsRunsResponse200
    | GetApiExperimentsRunsResponse400
    | GetApiExperimentsRunsResponse401
    | GetApiExperimentsRunsResponse404
    | None
):
    """List runs of an experiment

     Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.

    Args:
        experiment_slug (str):
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsRunsResponse200 | GetApiExperimentsRunsResponse400 | GetApiExperimentsRunsResponse401 | GetApiExperimentsRunsResponse404
    """

    return sync_detailed(
        client=client,
        experiment_slug=experiment_slug,
        page=page,
        page_size=page_size,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    experiment_slug: str,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> Response[
    GetApiExperimentsRunsResponse200
    | GetApiExperimentsRunsResponse400
    | GetApiExperimentsRunsResponse401
    | GetApiExperimentsRunsResponse404
]:
    """List runs of an experiment

     Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.

    Args:
        experiment_slug (str):
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsRunsResponse200 | GetApiExperimentsRunsResponse400 | GetApiExperimentsRunsResponse401 | GetApiExperimentsRunsResponse404]
    """

    kwargs = _get_kwargs(
        experiment_slug=experiment_slug,
        page=page,
        page_size=page_size,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    experiment_slug: str,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> (
    GetApiExperimentsRunsResponse200
    | GetApiExperimentsRunsResponse400
    | GetApiExperimentsRunsResponse401
    | GetApiExperimentsRunsResponse404
    | None
):
    """List runs of an experiment

     Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.

    Args:
        experiment_slug (str):
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsRunsResponse200 | GetApiExperimentsRunsResponse400 | GetApiExperimentsRunsResponse401 | GetApiExperimentsRunsResponse404
    """

    return (
        await asyncio_detailed(
            client=client,
            experiment_slug=experiment_slug,
            page=page,
            page_size=page_size,
        )
    ).parsed
