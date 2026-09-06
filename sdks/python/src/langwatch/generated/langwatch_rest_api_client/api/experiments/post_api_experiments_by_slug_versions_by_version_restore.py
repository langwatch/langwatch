from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_experiments_by_slug_versions_by_version_restore_response_200 import (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200,
)
from ...models.post_api_experiments_by_slug_versions_by_version_restore_response_400 import (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse400,
)
from ...models.post_api_experiments_by_slug_versions_by_version_restore_response_401 import (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse401,
)
from ...models.post_api_experiments_by_slug_versions_by_version_restore_response_404 import (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse404,
)
from ...models.post_api_experiments_by_slug_versions_by_version_restore_response_409 import (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse409,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    slug: str,
    version: int,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/experiments/{slug}/versions/{version}/restore".format(
            slug=quote(str(slug), safe=""),
            version=quote(str(version), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
    | None
):
    if response.status_code == 200:
        response_200 = PostApiExperimentsBySlugVersionsByVersionRestoreResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiExperimentsBySlugVersionsByVersionRestoreResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiExperimentsBySlugVersionsByVersionRestoreResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiExperimentsBySlugVersionsByVersionRestoreResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostApiExperimentsBySlugVersionsByVersionRestoreResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
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
    version: int,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
]:
    """Restore an experiment version

     Bring an old setup back by writing it forward as a new save. History is never rewritten: the version
    you restored from stays in the list, and the restore is one more entry after it.

    Args:
        slug (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiExperimentsBySlugVersionsByVersionRestoreResponse200 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409]
    """

    kwargs = _get_kwargs(
        slug=slug,
        version=version,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
    | None
):
    """Restore an experiment version

     Bring an old setup back by writing it forward as a new save. History is never rewritten: the version
    you restored from stays in the list, and the restore is one more entry after it.

    Args:
        slug (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiExperimentsBySlugVersionsByVersionRestoreResponse200 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
    """

    return sync_detailed(
        slug=slug,
        version=version,
        client=client,
    ).parsed


async def asyncio_detailed(
    slug: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
]:
    """Restore an experiment version

     Bring an old setup back by writing it forward as a new save. History is never rewritten: the version
    you restored from stays in the list, and the restore is one more entry after it.

    Args:
        slug (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiExperimentsBySlugVersionsByVersionRestoreResponse200 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409]
    """

    kwargs = _get_kwargs(
        slug=slug,
        version=version,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiExperimentsBySlugVersionsByVersionRestoreResponse200
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404
    | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
    | None
):
    """Restore an experiment version

     Bring an old setup back by writing it forward as a new save. History is never rewritten: the version
    you restored from stays in the list, and the restore is one more entry after it.

    Args:
        slug (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiExperimentsBySlugVersionsByVersionRestoreResponse200 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse400 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse401 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse404 | PostApiExperimentsBySlugVersionsByVersionRestoreResponse409
    """

    return (
        await asyncio_detailed(
            slug=slug,
            version=version,
            client=client,
        )
    ).parsed
