from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    experiment_slug: str | Unset = UNSET,
    page: str | Unset = UNSET,
    page_size: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["experimentSlug"] = experiment_slug

    params["page"] = page

    params["pageSize"] = page_size

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/experiments/runs",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if response.status_code == 400:
        return None

    if response.status_code == 401:
        return None

    if response.status_code == 404:
        return None

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
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
    experiment_slug: str | Unset = UNSET,
    page: str | Unset = UNSET,
    page_size: str | Unset = UNSET,
) -> Response[Any]:
    """List runs of an experiment

     Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.

    Args:
        experiment_slug (str | Unset):
        page (str | Unset):
        page_size (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
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


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    experiment_slug: str | Unset = UNSET,
    page: str | Unset = UNSET,
    page_size: str | Unset = UNSET,
) -> Response[Any]:
    """List runs of an experiment

     Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.

    Args:
        experiment_slug (str | Unset):
        page (str | Unset):
        page_size (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        experiment_slug=experiment_slug,
        page=page,
        page_size=page_size,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
