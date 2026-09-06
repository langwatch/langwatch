from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_by_slug_response_200 import GetApiExperimentsBySlugResponse200
from ...models.get_api_experiments_by_slug_response_400 import GetApiExperimentsBySlugResponse400
from ...models.get_api_experiments_by_slug_response_401 import GetApiExperimentsBySlugResponse401
from ...models.get_api_experiments_by_slug_response_404 import GetApiExperimentsBySlugResponse404
from ...models.get_api_experiments_by_slug_response_422 import GetApiExperimentsBySlugResponse422
from ...models.get_api_experiments_by_slug_response_500 import GetApiExperimentsBySlugResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    slug: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/experiments/{slug}".format(
            slug=quote(str(slug), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiExperimentsBySlugResponse200
    | GetApiExperimentsBySlugResponse400
    | GetApiExperimentsBySlugResponse401
    | GetApiExperimentsBySlugResponse404
    | GetApiExperimentsBySlugResponse422
    | GetApiExperimentsBySlugResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiExperimentsBySlugResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiExperimentsBySlugResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiExperimentsBySlugResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiExperimentsBySlugResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiExperimentsBySlugResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiExperimentsBySlugResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiExperimentsBySlugResponse200
    | GetApiExperimentsBySlugResponse400
    | GetApiExperimentsBySlugResponse401
    | GetApiExperimentsBySlugResponse404
    | GetApiExperimentsBySlugResponse422
    | GetApiExperimentsBySlugResponse500
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
    slug: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiExperimentsBySlugResponse200
    | GetApiExperimentsBySlugResponse400
    | GetApiExperimentsBySlugResponse401
    | GetApiExperimentsBySlugResponse404
    | GetApiExperimentsBySlugResponse422
    | GetApiExperimentsBySlugResponse500
]:
    """Read one experiment

     Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id
    as well, so either identifier the list hands back can be used.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsBySlugResponse200 | GetApiExperimentsBySlugResponse400 | GetApiExperimentsBySlugResponse401 | GetApiExperimentsBySlugResponse404 | GetApiExperimentsBySlugResponse422 | GetApiExperimentsBySlugResponse500]
    """

    kwargs = _get_kwargs(
        slug=slug,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiExperimentsBySlugResponse200
    | GetApiExperimentsBySlugResponse400
    | GetApiExperimentsBySlugResponse401
    | GetApiExperimentsBySlugResponse404
    | GetApiExperimentsBySlugResponse422
    | GetApiExperimentsBySlugResponse500
    | None
):
    """Read one experiment

     Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id
    as well, so either identifier the list hands back can be used.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsBySlugResponse200 | GetApiExperimentsBySlugResponse400 | GetApiExperimentsBySlugResponse401 | GetApiExperimentsBySlugResponse404 | GetApiExperimentsBySlugResponse422 | GetApiExperimentsBySlugResponse500
    """

    return sync_detailed(
        slug=slug,
        client=client,
    ).parsed


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiExperimentsBySlugResponse200
    | GetApiExperimentsBySlugResponse400
    | GetApiExperimentsBySlugResponse401
    | GetApiExperimentsBySlugResponse404
    | GetApiExperimentsBySlugResponse422
    | GetApiExperimentsBySlugResponse500
]:
    """Read one experiment

     Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id
    as well, so either identifier the list hands back can be used.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsBySlugResponse200 | GetApiExperimentsBySlugResponse400 | GetApiExperimentsBySlugResponse401 | GetApiExperimentsBySlugResponse404 | GetApiExperimentsBySlugResponse422 | GetApiExperimentsBySlugResponse500]
    """

    kwargs = _get_kwargs(
        slug=slug,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiExperimentsBySlugResponse200
    | GetApiExperimentsBySlugResponse400
    | GetApiExperimentsBySlugResponse401
    | GetApiExperimentsBySlugResponse404
    | GetApiExperimentsBySlugResponse422
    | GetApiExperimentsBySlugResponse500
    | None
):
    """Read one experiment

     Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id
    as well, so either identifier the list hands back can be used.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsBySlugResponse200 | GetApiExperimentsBySlugResponse400 | GetApiExperimentsBySlugResponse401 | GetApiExperimentsBySlugResponse404 | GetApiExperimentsBySlugResponse422 | GetApiExperimentsBySlugResponse500
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
        )
    ).parsed
