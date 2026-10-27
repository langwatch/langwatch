from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dataset_by_slug_or_id_upload_body import PostApiDatasetBySlugOrIdUploadBody
from ...models.post_api_dataset_by_slug_or_id_upload_response_200 import PostApiDatasetBySlugOrIdUploadResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    slug_or_id: str,
    *,
    body: PostApiDatasetBySlugOrIdUploadBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dataset/{slug_or_id}/upload".format(
            slug_or_id=quote(str(slug_or_id), safe=""),
        ),
    }

    _kwargs["files"] = body.to_multipart()

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiDatasetBySlugOrIdUploadResponse200 | None:
    if response.status_code == 200:
        response_200 = PostApiDatasetBySlugOrIdUploadResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiDatasetBySlugOrIdUploadResponse200]:
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
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetBySlugOrIdUploadBody,
) -> Response[PostApiDatasetBySlugOrIdUploadResponse200]:
    """Upload a file (CSV, JSON, JSONL) to an existing dataset upload the file as a stored object with the
    purpose dataset_import, then create the dataset from it

    Args:
        slug_or_id (str):
        body (PostApiDatasetBySlugOrIdUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetBySlugOrIdUploadResponse200]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug_or_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetBySlugOrIdUploadBody,
) -> PostApiDatasetBySlugOrIdUploadResponse200 | None:
    """Upload a file (CSV, JSON, JSONL) to an existing dataset upload the file as a stored object with the
    purpose dataset_import, then create the dataset from it

    Args:
        slug_or_id (str):
        body (PostApiDatasetBySlugOrIdUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetBySlugOrIdUploadResponse200
    """

    return sync_detailed(
        slug_or_id=slug_or_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    slug_or_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetBySlugOrIdUploadBody,
) -> Response[PostApiDatasetBySlugOrIdUploadResponse200]:
    """Upload a file (CSV, JSON, JSONL) to an existing dataset upload the file as a stored object with the
    purpose dataset_import, then create the dataset from it

    Args:
        slug_or_id (str):
        body (PostApiDatasetBySlugOrIdUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetBySlugOrIdUploadResponse200]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug_or_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetBySlugOrIdUploadBody,
) -> PostApiDatasetBySlugOrIdUploadResponse200 | None:
    """Upload a file (CSV, JSON, JSONL) to an existing dataset upload the file as a stored object with the
    purpose dataset_import, then create the dataset from it

    Args:
        slug_or_id (str):
        body (PostApiDatasetBySlugOrIdUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetBySlugOrIdUploadResponse200
    """

    return (
        await asyncio_detailed(
            slug_or_id=slug_or_id,
            client=client,
            body=body,
        )
    ).parsed
