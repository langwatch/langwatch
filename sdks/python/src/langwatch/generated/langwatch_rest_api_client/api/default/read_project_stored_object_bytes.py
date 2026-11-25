from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    project_id: str,
    stored_object_id: str,
    *,
    filename: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["filename"] = filename

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/files/{project_id}/{stored_object_id}".format(
            project_id=quote(str(project_id), safe=""),
            stored_object_id=quote(str(stored_object_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
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
    project_id: str,
    stored_object_id: str,
    *,
    client: AuthenticatedClient,
    filename: str | Unset = UNSET,
) -> Response[Any]:
    """
    Args:
        project_id (str):
        stored_object_id (str):
        filename (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        stored_object_id=stored_object_id,
        filename=filename,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    project_id: str,
    stored_object_id: str,
    *,
    client: AuthenticatedClient,
    filename: str | Unset = UNSET,
) -> Response[Any]:
    """
    Args:
        project_id (str):
        stored_object_id (str):
        filename (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        project_id=project_id,
        stored_object_id=stored_object_id,
        filename=filename,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
