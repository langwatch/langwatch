from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dataset_attachments_uploads_body import PostApiDatasetAttachmentsUploadsBody
from ...models.post_api_dataset_attachments_uploads_response_201 import PostApiDatasetAttachmentsUploadsResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiDatasetAttachmentsUploadsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dataset/attachments/uploads",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | PostApiDatasetAttachmentsUploadsResponse201 | None:
    if response.status_code == 201:
        response_201 = PostApiDatasetAttachmentsUploadsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 413:
        response_413 = cast(Any, None)
        return response_413

    if response.status_code == 415:
        response_415 = cast(Any, None)
        return response_415

    if response.status_code == 429:
        response_429 = cast(Any, None)
        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | PostApiDatasetAttachmentsUploadsResponse201]:
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
    body: PostApiDatasetAttachmentsUploadsBody,
) -> Response[Any | PostApiDatasetAttachmentsUploadsResponse201]:
    """Create an upload for an image or file cell

     Answers the address to PUT the file to. After the PUT, confirm the upload at `POST /api/v1/stored-
    objects/uploads/{objectId}/confirmation`, then write `/api/files/{projectId}/{objectId}/{filename}`
    into the cell.

    Args:
        body (PostApiDatasetAttachmentsUploadsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiDatasetAttachmentsUploadsResponse201]
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
    body: PostApiDatasetAttachmentsUploadsBody,
) -> Any | PostApiDatasetAttachmentsUploadsResponse201 | None:
    """Create an upload for an image or file cell

     Answers the address to PUT the file to. After the PUT, confirm the upload at `POST /api/v1/stored-
    objects/uploads/{objectId}/confirmation`, then write `/api/files/{projectId}/{objectId}/{filename}`
    into the cell.

    Args:
        body (PostApiDatasetAttachmentsUploadsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiDatasetAttachmentsUploadsResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetAttachmentsUploadsBody,
) -> Response[Any | PostApiDatasetAttachmentsUploadsResponse201]:
    """Create an upload for an image or file cell

     Answers the address to PUT the file to. After the PUT, confirm the upload at `POST /api/v1/stored-
    objects/uploads/{objectId}/confirmation`, then write `/api/files/{projectId}/{objectId}/{filename}`
    into the cell.

    Args:
        body (PostApiDatasetAttachmentsUploadsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiDatasetAttachmentsUploadsResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetAttachmentsUploadsBody,
) -> Any | PostApiDatasetAttachmentsUploadsResponse201 | None:
    """Create an upload for an image or file cell

     Answers the address to PUT the file to. After the PUT, confirm the upload at `POST /api/v1/stored-
    objects/uploads/{objectId}/confirmation`, then write `/api/files/{projectId}/{objectId}/{filename}`
    into the cell.

    Args:
        body (PostApiDatasetAttachmentsUploadsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiDatasetAttachmentsUploadsResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
