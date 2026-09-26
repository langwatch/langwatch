from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dataset_attachments_body import PostApiDatasetAttachmentsBody
from ...models.post_api_dataset_attachments_response_200 import PostApiDatasetAttachmentsResponse200
from ...models.post_api_dataset_attachments_response_400 import PostApiDatasetAttachmentsResponse400
from ...models.post_api_dataset_attachments_response_401 import PostApiDatasetAttachmentsResponse401
from ...models.post_api_dataset_attachments_response_413 import PostApiDatasetAttachmentsResponse413
from ...models.post_api_dataset_attachments_response_415 import PostApiDatasetAttachmentsResponse415
from ...models.post_api_dataset_attachments_response_422 import PostApiDatasetAttachmentsResponse422
from ...models.post_api_dataset_attachments_response_429 import PostApiDatasetAttachmentsResponse429
from ...models.post_api_dataset_attachments_response_500 import PostApiDatasetAttachmentsResponse500
from ...types import UNSET, Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiDatasetAttachmentsBody,
    project_id: str,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    params: dict[str, Any] = {}

    params["projectId"] = project_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dataset/attachments",
        "params": params,
    }

    _kwargs["files"] = body.to_multipart()

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiDatasetAttachmentsResponse200
    | PostApiDatasetAttachmentsResponse400
    | PostApiDatasetAttachmentsResponse401
    | PostApiDatasetAttachmentsResponse413
    | PostApiDatasetAttachmentsResponse415
    | PostApiDatasetAttachmentsResponse422
    | PostApiDatasetAttachmentsResponse429
    | PostApiDatasetAttachmentsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiDatasetAttachmentsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiDatasetAttachmentsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiDatasetAttachmentsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 413:
        response_413 = PostApiDatasetAttachmentsResponse413.from_dict(response.json())

        return response_413

    if response.status_code == 415:
        response_415 = PostApiDatasetAttachmentsResponse415.from_dict(response.json())

        return response_415

    if response.status_code == 422:
        response_422 = PostApiDatasetAttachmentsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 429:
        response_429 = PostApiDatasetAttachmentsResponse429.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = PostApiDatasetAttachmentsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiDatasetAttachmentsResponse200
    | PostApiDatasetAttachmentsResponse400
    | PostApiDatasetAttachmentsResponse401
    | PostApiDatasetAttachmentsResponse413
    | PostApiDatasetAttachmentsResponse415
    | PostApiDatasetAttachmentsResponse422
    | PostApiDatasetAttachmentsResponse429
    | PostApiDatasetAttachmentsResponse500
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
    body: PostApiDatasetAttachmentsBody,
    project_id: str,
) -> Response[
    PostApiDatasetAttachmentsResponse200
    | PostApiDatasetAttachmentsResponse400
    | PostApiDatasetAttachmentsResponse401
    | PostApiDatasetAttachmentsResponse413
    | PostApiDatasetAttachmentsResponse415
    | PostApiDatasetAttachmentsResponse422
    | PostApiDatasetAttachmentsResponse429
    | PostApiDatasetAttachmentsResponse500
]:
    """Upload a file for an image or file column and get the reference a cell holds. The project is named
    by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional
    `datasetId` field.

    Args:
        project_id (str):
        body (PostApiDatasetAttachmentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetAttachmentsResponse200 | PostApiDatasetAttachmentsResponse400 | PostApiDatasetAttachmentsResponse401 | PostApiDatasetAttachmentsResponse413 | PostApiDatasetAttachmentsResponse415 | PostApiDatasetAttachmentsResponse422 | PostApiDatasetAttachmentsResponse429 | PostApiDatasetAttachmentsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
        project_id=project_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetAttachmentsBody,
    project_id: str,
) -> (
    PostApiDatasetAttachmentsResponse200
    | PostApiDatasetAttachmentsResponse400
    | PostApiDatasetAttachmentsResponse401
    | PostApiDatasetAttachmentsResponse413
    | PostApiDatasetAttachmentsResponse415
    | PostApiDatasetAttachmentsResponse422
    | PostApiDatasetAttachmentsResponse429
    | PostApiDatasetAttachmentsResponse500
    | None
):
    """Upload a file for an image or file column and get the reference a cell holds. The project is named
    by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional
    `datasetId` field.

    Args:
        project_id (str):
        body (PostApiDatasetAttachmentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetAttachmentsResponse200 | PostApiDatasetAttachmentsResponse400 | PostApiDatasetAttachmentsResponse401 | PostApiDatasetAttachmentsResponse413 | PostApiDatasetAttachmentsResponse415 | PostApiDatasetAttachmentsResponse422 | PostApiDatasetAttachmentsResponse429 | PostApiDatasetAttachmentsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
        project_id=project_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetAttachmentsBody,
    project_id: str,
) -> Response[
    PostApiDatasetAttachmentsResponse200
    | PostApiDatasetAttachmentsResponse400
    | PostApiDatasetAttachmentsResponse401
    | PostApiDatasetAttachmentsResponse413
    | PostApiDatasetAttachmentsResponse415
    | PostApiDatasetAttachmentsResponse422
    | PostApiDatasetAttachmentsResponse429
    | PostApiDatasetAttachmentsResponse500
]:
    """Upload a file for an image or file column and get the reference a cell holds. The project is named
    by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional
    `datasetId` field.

    Args:
        project_id (str):
        body (PostApiDatasetAttachmentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetAttachmentsResponse200 | PostApiDatasetAttachmentsResponse400 | PostApiDatasetAttachmentsResponse401 | PostApiDatasetAttachmentsResponse413 | PostApiDatasetAttachmentsResponse415 | PostApiDatasetAttachmentsResponse422 | PostApiDatasetAttachmentsResponse429 | PostApiDatasetAttachmentsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
        project_id=project_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetAttachmentsBody,
    project_id: str,
) -> (
    PostApiDatasetAttachmentsResponse200
    | PostApiDatasetAttachmentsResponse400
    | PostApiDatasetAttachmentsResponse401
    | PostApiDatasetAttachmentsResponse413
    | PostApiDatasetAttachmentsResponse415
    | PostApiDatasetAttachmentsResponse422
    | PostApiDatasetAttachmentsResponse429
    | PostApiDatasetAttachmentsResponse500
    | None
):
    """Upload a file for an image or file column and get the reference a cell holds. The project is named
    by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional
    `datasetId` field.

    Args:
        project_id (str):
        body (PostApiDatasetAttachmentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetAttachmentsResponse200 | PostApiDatasetAttachmentsResponse400 | PostApiDatasetAttachmentsResponse401 | PostApiDatasetAttachmentsResponse413 | PostApiDatasetAttachmentsResponse415 | PostApiDatasetAttachmentsResponse422 | PostApiDatasetAttachmentsResponse429 | PostApiDatasetAttachmentsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            project_id=project_id,
        )
    ).parsed
