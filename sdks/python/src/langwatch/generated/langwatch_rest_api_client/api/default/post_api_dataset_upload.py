from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dataset_upload_body import PostApiDatasetUploadBody
from ...models.post_api_dataset_upload_response_201 import PostApiDatasetUploadResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiDatasetUploadBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dataset/upload",
    }

    _kwargs["files"] = body.to_multipart()

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiDatasetUploadResponse201 | None:
    if response.status_code == 201:
        response_201 = PostApiDatasetUploadResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiDatasetUploadResponse201]:
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
    body: PostApiDatasetUploadBody,
) -> Response[PostApiDatasetUploadResponse201]:
    """Create a new dataset from an uploaded file (CSV, JSON, JSONL) upload the file as a stored object
    with the purpose dataset_import, then create the dataset from it

    Args:
        body (PostApiDatasetUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetUploadResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetUploadBody,
) -> PostApiDatasetUploadResponse201 | None:
    """Create a new dataset from an uploaded file (CSV, JSON, JSONL) upload the file as a stored object
    with the purpose dataset_import, then create the dataset from it

    Args:
        body (PostApiDatasetUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetUploadResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetUploadBody,
) -> Response[PostApiDatasetUploadResponse201]:
    """Create a new dataset from an uploaded file (CSV, JSON, JSONL) upload the file as a stored object
    with the purpose dataset_import, then create the dataset from it

    Args:
        body (PostApiDatasetUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetUploadResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetUploadBody,
) -> PostApiDatasetUploadResponse201 | None:
    """Create a new dataset from an uploaded file (CSV, JSON, JSONL) upload the file as a stored object
    with the purpose dataset_import, then create the dataset from it

    Args:
        body (PostApiDatasetUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetUploadResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
