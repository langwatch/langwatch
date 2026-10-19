from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_dataset_by_slug_or_id_records_body import DeleteApiDatasetBySlugOrIdRecordsBody
from ...models.delete_api_dataset_by_slug_or_id_records_response_200 import DeleteApiDatasetBySlugOrIdRecordsResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    slug_or_id: str,
    *,
    body: DeleteApiDatasetBySlugOrIdRecordsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/dataset/{slug_or_id}/records".format(
            slug_or_id=quote(str(slug_or_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> DeleteApiDatasetBySlugOrIdRecordsResponse200 | None:
    if response.status_code == 200:
        response_200 = DeleteApiDatasetBySlugOrIdRecordsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[DeleteApiDatasetBySlugOrIdRecordsResponse200]:
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
    body: DeleteApiDatasetBySlugOrIdRecordsBody,
) -> Response[DeleteApiDatasetBySlugOrIdRecordsResponse200]:
    """Delete records from a dataset by IDs

    Args:
        slug_or_id (str):
        body (DeleteApiDatasetBySlugOrIdRecordsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiDatasetBySlugOrIdRecordsResponse200]
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
    body: DeleteApiDatasetBySlugOrIdRecordsBody,
) -> DeleteApiDatasetBySlugOrIdRecordsResponse200 | None:
    """Delete records from a dataset by IDs

    Args:
        slug_or_id (str):
        body (DeleteApiDatasetBySlugOrIdRecordsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiDatasetBySlugOrIdRecordsResponse200
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
    body: DeleteApiDatasetBySlugOrIdRecordsBody,
) -> Response[DeleteApiDatasetBySlugOrIdRecordsResponse200]:
    """Delete records from a dataset by IDs

    Args:
        slug_or_id (str):
        body (DeleteApiDatasetBySlugOrIdRecordsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiDatasetBySlugOrIdRecordsResponse200]
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
    body: DeleteApiDatasetBySlugOrIdRecordsBody,
) -> DeleteApiDatasetBySlugOrIdRecordsResponse200 | None:
    """Delete records from a dataset by IDs

    Args:
        slug_or_id (str):
        body (DeleteApiDatasetBySlugOrIdRecordsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiDatasetBySlugOrIdRecordsResponse200
    """

    return (
        await asyncio_detailed(
            slug_or_id=slug_or_id,
            client=client,
            body=body,
        )
    ).parsed
