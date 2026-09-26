from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_stored_object_audience import GetStoredObjectAudience
from ...models.get_stored_object_response_200 import GetStoredObjectResponse200
from ...types import UNSET, Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    project_id: str,
    audience: GetStoredObjectAudience,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["projectId"] = project_id

    json_audience = audience.value
    params["audience"] = json_audience

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/stored-objects/{id}".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetStoredObjectResponse200 | None:
    if response.status_code == 200:
        response_200 = GetStoredObjectResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetStoredObjectResponse200]:
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
    *,
    client: AuthenticatedClient,
    project_id: str,
    audience: GetStoredObjectAudience,
) -> Response[GetStoredObjectResponse200]:
    """Resolve a fresh stored-object capability

    Args:
        id (str):
        project_id (str):
        audience (GetStoredObjectAudience):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetStoredObjectResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        project_id=project_id,
        audience=audience,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    project_id: str,
    audience: GetStoredObjectAudience,
) -> GetStoredObjectResponse200 | None:
    """Resolve a fresh stored-object capability

    Args:
        id (str):
        project_id (str):
        audience (GetStoredObjectAudience):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetStoredObjectResponse200
    """

    return sync_detailed(
        id=id,
        client=client,
        project_id=project_id,
        audience=audience,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    project_id: str,
    audience: GetStoredObjectAudience,
) -> Response[GetStoredObjectResponse200]:
    """Resolve a fresh stored-object capability

    Args:
        id (str):
        project_id (str):
        audience (GetStoredObjectAudience):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetStoredObjectResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        project_id=project_id,
        audience=audience,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    project_id: str,
    audience: GetStoredObjectAudience,
) -> GetStoredObjectResponse200 | None:
    """Resolve a fresh stored-object capability

    Args:
        id (str):
        project_id (str):
        audience (GetStoredObjectAudience):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetStoredObjectResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            project_id=project_id,
            audience=audience,
        )
    ).parsed
