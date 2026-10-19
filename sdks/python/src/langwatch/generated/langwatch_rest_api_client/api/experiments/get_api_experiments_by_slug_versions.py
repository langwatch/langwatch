from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_by_slug_versions_response_200 import GetApiExperimentsBySlugVersionsResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    slug: str,
    *,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/experiments/{slug}/versions".format(
            slug=quote(str(slug), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | GetApiExperimentsBySlugVersionsResponse200 | None:
    if response.status_code == 200:
        response_200 = GetApiExperimentsBySlugVersionsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | GetApiExperimentsBySlugVersionsResponse200]:
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
    slug: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> Response[Any | GetApiExperimentsBySlugVersionsResponse200]:
    """List an experiment's versions

     Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore
    each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with
    `autoSaved` true. Page through them with `limit` and `cursor`.

    Args:
        slug (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiExperimentsBySlugVersionsResponse200]
    """

    kwargs = _get_kwargs(
        slug=slug,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> Any | GetApiExperimentsBySlugVersionsResponse200 | None:
    """List an experiment's versions

     Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore
    each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with
    `autoSaved` true. Page through them with `limit` and `cursor`.

    Args:
        slug (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiExperimentsBySlugVersionsResponse200
    """

    return sync_detailed(
        slug=slug,
        client=client,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> Response[Any | GetApiExperimentsBySlugVersionsResponse200]:
    """List an experiment's versions

     Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore
    each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with
    `autoSaved` true. Page through them with `limit` and `cursor`.

    Args:
        slug (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiExperimentsBySlugVersionsResponse200]
    """

    kwargs = _get_kwargs(
        slug=slug,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> Any | GetApiExperimentsBySlugVersionsResponse200 | None:
    """List an experiment's versions

     Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore
    each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with
    `autoSaved` true. Page through them with `limit` and `cursor`.

    Args:
        slug (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiExperimentsBySlugVersionsResponse200
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
