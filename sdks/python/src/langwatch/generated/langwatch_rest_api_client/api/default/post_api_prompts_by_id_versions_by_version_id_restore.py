from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_prompts_by_id_versions_by_version_id_restore_response_200 import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200,
)
from ...models.post_api_prompts_by_id_versions_by_version_id_restore_response_400 import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse400,
)
from ...models.post_api_prompts_by_id_versions_by_version_id_restore_response_401 import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse401,
)
from ...models.post_api_prompts_by_id_versions_by_version_id_restore_response_404 import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse404,
)
from ...models.post_api_prompts_by_id_versions_by_version_id_restore_response_422 import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse422,
)
from ...models.post_api_prompts_by_id_versions_by_version_id_restore_response_500 import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    version_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/prompts/{id}/versions/{version_id}/restore".format(
            id=quote(str(id), safe=""),
            version_id=quote(str(version_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiPromptsByIdVersionsByVersionIdRestoreResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiPromptsByIdVersionsByVersionIdRestoreResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiPromptsByIdVersionsByVersionIdRestoreResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiPromptsByIdVersionsByVersionIdRestoreResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PostApiPromptsByIdVersionsByVersionIdRestoreResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiPromptsByIdVersionsByVersionIdRestoreResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
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
    id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
]:
    """Restore a prompt to a previous version. Creates a new version with the same config data as the
    specified version.

    Args:
        id (str):
        version_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsByIdVersionsByVersionIdRestoreResponse200 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        version_id=version_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
    | None
):
    """Restore a prompt to a previous version. Creates a new version with the same config data as the
    specified version.

    Args:
        id (str):
        version_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsByIdVersionsByVersionIdRestoreResponse200 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
    """

    return sync_detailed(
        id=id,
        version_id=version_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
]:
    """Restore a prompt to a previous version. Creates a new version with the same config data as the
    specified version.

    Args:
        id (str):
        version_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiPromptsByIdVersionsByVersionIdRestoreResponse200 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        version_id=version_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422
    | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
    | None
):
    """Restore a prompt to a previous version. Creates a new version with the same config data as the
    specified version.

    Args:
        id (str):
        version_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiPromptsByIdVersionsByVersionIdRestoreResponse200 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse400 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse401 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse404 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse422 | PostApiPromptsByIdVersionsByVersionIdRestoreResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            version_id=version_id,
            client=client,
        )
    ).parsed
