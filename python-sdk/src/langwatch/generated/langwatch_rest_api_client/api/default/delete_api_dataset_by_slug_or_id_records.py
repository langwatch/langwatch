from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_dataset_by_slug_or_id_records_body import DeleteApiDatasetBySlugOrIdRecordsBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    slug_or_id: str,
    *,
    body: DeleteApiDatasetBySlugOrIdRecordsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/dataset/{slug_or_id}/records".format(
            slug_or_id=quote(str(slug_or_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    slug_or_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: DeleteApiDatasetBySlugOrIdRecordsBody | Unset = UNSET,
) -> Response[Any]:
    """Delete records from a dataset by IDs

    Args:
        slug_or_id (str):
        body (DeleteApiDatasetBySlugOrIdRecordsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    slug_or_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: DeleteApiDatasetBySlugOrIdRecordsBody | Unset = UNSET,
) -> Response[Any]:
    """Delete records from a dataset by IDs

    Args:
        slug_or_id (str):
        body (DeleteApiDatasetBySlugOrIdRecordsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        slug_or_id=slug_or_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
