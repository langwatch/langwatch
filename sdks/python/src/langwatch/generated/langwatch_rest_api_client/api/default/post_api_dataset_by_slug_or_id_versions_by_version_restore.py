from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dataset_by_slug_or_id_versions_by_version_restore_response_200 import (
    PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    slug_or_id: str,
    version: int,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dataset/{slug_or_id}/versions/{version}/restore".format(
            slug_or_id=quote(str(slug_or_id), safe=""),
            version=quote(str(version), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200 | None:
    if response.status_code == 200:
        response_200 = PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200]:
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
    slug_or_id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> Response[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200]:
    """Restore a dataset version

     Restore a version: the dataset's columns and rows become the version's, and the result is saved as a
    new version. Earlier versions are never changed.

    Args:
        slug_or_id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
        version=version,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug_or_id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200 | None:
    """Restore a dataset version

     Restore a version: the dataset's columns and rows become the version's, and the result is saved as a
    new version. Earlier versions are never changed.

    Args:
        slug_or_id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200
    """

    return sync_detailed(
        slug_or_id=slug_or_id,
        version=version,
        client=client,
    ).parsed


async def asyncio_detailed(
    slug_or_id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> Response[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200]:
    """Restore a dataset version

     Restore a version: the dataset's columns and rows become the version's, and the result is saved as a
    new version. Earlier versions are never changed.

    Args:
        slug_or_id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
        version=version,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug_or_id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200 | None:
    """Restore a dataset version

     Restore a version: the dataset's columns and rows become the version's, and the result is saved as a
    new version. Earlier versions are never changed.

    Args:
        slug_or_id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetBySlugOrIdVersionsByVersionRestoreResponse200
    """

    return (
        await asyncio_detailed(
            slug_or_id=slug_or_id,
            version=version,
            client=client,
        )
    ).parsed
