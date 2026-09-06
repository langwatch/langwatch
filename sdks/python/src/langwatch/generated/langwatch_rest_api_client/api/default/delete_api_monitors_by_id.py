from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_monitors_by_id_response_200 import DeleteApiMonitorsByIdResponse200
from ...models.delete_api_monitors_by_id_response_400 import DeleteApiMonitorsByIdResponse400
from ...models.delete_api_monitors_by_id_response_401 import DeleteApiMonitorsByIdResponse401
from ...models.delete_api_monitors_by_id_response_404 import DeleteApiMonitorsByIdResponse404
from ...models.delete_api_monitors_by_id_response_422 import DeleteApiMonitorsByIdResponse422
from ...models.delete_api_monitors_by_id_response_500 import DeleteApiMonitorsByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/monitors/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiMonitorsByIdResponse200
    | DeleteApiMonitorsByIdResponse400
    | DeleteApiMonitorsByIdResponse401
    | DeleteApiMonitorsByIdResponse404
    | DeleteApiMonitorsByIdResponse422
    | DeleteApiMonitorsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiMonitorsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiMonitorsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiMonitorsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = DeleteApiMonitorsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = DeleteApiMonitorsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = DeleteApiMonitorsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiMonitorsByIdResponse200
    | DeleteApiMonitorsByIdResponse400
    | DeleteApiMonitorsByIdResponse401
    | DeleteApiMonitorsByIdResponse404
    | DeleteApiMonitorsByIdResponse422
    | DeleteApiMonitorsByIdResponse500
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
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiMonitorsByIdResponse200
    | DeleteApiMonitorsByIdResponse400
    | DeleteApiMonitorsByIdResponse401
    | DeleteApiMonitorsByIdResponse404
    | DeleteApiMonitorsByIdResponse422
    | DeleteApiMonitorsByIdResponse500
]:
    """Delete a monitor

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiMonitorsByIdResponse200 | DeleteApiMonitorsByIdResponse400 | DeleteApiMonitorsByIdResponse401 | DeleteApiMonitorsByIdResponse404 | DeleteApiMonitorsByIdResponse422 | DeleteApiMonitorsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiMonitorsByIdResponse200
    | DeleteApiMonitorsByIdResponse400
    | DeleteApiMonitorsByIdResponse401
    | DeleteApiMonitorsByIdResponse404
    | DeleteApiMonitorsByIdResponse422
    | DeleteApiMonitorsByIdResponse500
    | None
):
    """Delete a monitor

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiMonitorsByIdResponse200 | DeleteApiMonitorsByIdResponse400 | DeleteApiMonitorsByIdResponse401 | DeleteApiMonitorsByIdResponse404 | DeleteApiMonitorsByIdResponse422 | DeleteApiMonitorsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiMonitorsByIdResponse200
    | DeleteApiMonitorsByIdResponse400
    | DeleteApiMonitorsByIdResponse401
    | DeleteApiMonitorsByIdResponse404
    | DeleteApiMonitorsByIdResponse422
    | DeleteApiMonitorsByIdResponse500
]:
    """Delete a monitor

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiMonitorsByIdResponse200 | DeleteApiMonitorsByIdResponse400 | DeleteApiMonitorsByIdResponse401 | DeleteApiMonitorsByIdResponse404 | DeleteApiMonitorsByIdResponse422 | DeleteApiMonitorsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiMonitorsByIdResponse200
    | DeleteApiMonitorsByIdResponse400
    | DeleteApiMonitorsByIdResponse401
    | DeleteApiMonitorsByIdResponse404
    | DeleteApiMonitorsByIdResponse422
    | DeleteApiMonitorsByIdResponse500
    | None
):
    """Delete a monitor

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiMonitorsByIdResponse200 | DeleteApiMonitorsByIdResponse400 | DeleteApiMonitorsByIdResponse401 | DeleteApiMonitorsByIdResponse404 | DeleteApiMonitorsByIdResponse422 | DeleteApiMonitorsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
