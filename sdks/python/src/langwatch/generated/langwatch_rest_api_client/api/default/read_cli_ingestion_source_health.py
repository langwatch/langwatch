from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.read_cli_ingestion_source_health_response_200 import ReadCliIngestionSourceHealthResponse200
from ...models.read_cli_ingestion_source_health_response_400 import ReadCliIngestionSourceHealthResponse400
from ...models.read_cli_ingestion_source_health_response_401 import ReadCliIngestionSourceHealthResponse401
from ...models.read_cli_ingestion_source_health_response_402 import ReadCliIngestionSourceHealthResponse402
from ...models.read_cli_ingestion_source_health_response_403 import ReadCliIngestionSourceHealthResponse403
from ...models.read_cli_ingestion_source_health_response_404 import ReadCliIngestionSourceHealthResponse404
from ...models.read_cli_ingestion_source_health_response_409 import ReadCliIngestionSourceHealthResponse409
from ...models.read_cli_ingestion_source_health_response_412 import ReadCliIngestionSourceHealthResponse412
from ...models.read_cli_ingestion_source_health_response_500 import ReadCliIngestionSourceHealthResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    source_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/cli/governance/ingest/sources/{source_id}/health".format(
            source_id=quote(str(source_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ReadCliIngestionSourceHealthResponse200
    | ReadCliIngestionSourceHealthResponse400
    | ReadCliIngestionSourceHealthResponse401
    | ReadCliIngestionSourceHealthResponse402
    | ReadCliIngestionSourceHealthResponse403
    | ReadCliIngestionSourceHealthResponse404
    | ReadCliIngestionSourceHealthResponse409
    | ReadCliIngestionSourceHealthResponse412
    | ReadCliIngestionSourceHealthResponse500
    | None
):
    if response.status_code == 200:
        response_200 = ReadCliIngestionSourceHealthResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ReadCliIngestionSourceHealthResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ReadCliIngestionSourceHealthResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ReadCliIngestionSourceHealthResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 403:
        response_403 = ReadCliIngestionSourceHealthResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ReadCliIngestionSourceHealthResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ReadCliIngestionSourceHealthResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 412:
        response_412 = ReadCliIngestionSourceHealthResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = ReadCliIngestionSourceHealthResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ReadCliIngestionSourceHealthResponse200
    | ReadCliIngestionSourceHealthResponse400
    | ReadCliIngestionSourceHealthResponse401
    | ReadCliIngestionSourceHealthResponse402
    | ReadCliIngestionSourceHealthResponse403
    | ReadCliIngestionSourceHealthResponse404
    | ReadCliIngestionSourceHealthResponse409
    | ReadCliIngestionSourceHealthResponse412
    | ReadCliIngestionSourceHealthResponse500
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
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    ReadCliIngestionSourceHealthResponse200
    | ReadCliIngestionSourceHealthResponse400
    | ReadCliIngestionSourceHealthResponse401
    | ReadCliIngestionSourceHealthResponse402
    | ReadCliIngestionSourceHealthResponse403
    | ReadCliIngestionSourceHealthResponse404
    | ReadCliIngestionSourceHealthResponse409
    | ReadCliIngestionSourceHealthResponse412
    | ReadCliIngestionSourceHealthResponse500
]:
    """
    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadCliIngestionSourceHealthResponse200 | ReadCliIngestionSourceHealthResponse400 | ReadCliIngestionSourceHealthResponse401 | ReadCliIngestionSourceHealthResponse402 | ReadCliIngestionSourceHealthResponse403 | ReadCliIngestionSourceHealthResponse404 | ReadCliIngestionSourceHealthResponse409 | ReadCliIngestionSourceHealthResponse412 | ReadCliIngestionSourceHealthResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    ReadCliIngestionSourceHealthResponse200
    | ReadCliIngestionSourceHealthResponse400
    | ReadCliIngestionSourceHealthResponse401
    | ReadCliIngestionSourceHealthResponse402
    | ReadCliIngestionSourceHealthResponse403
    | ReadCliIngestionSourceHealthResponse404
    | ReadCliIngestionSourceHealthResponse409
    | ReadCliIngestionSourceHealthResponse412
    | ReadCliIngestionSourceHealthResponse500
    | None
):
    """
    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadCliIngestionSourceHealthResponse200 | ReadCliIngestionSourceHealthResponse400 | ReadCliIngestionSourceHealthResponse401 | ReadCliIngestionSourceHealthResponse402 | ReadCliIngestionSourceHealthResponse403 | ReadCliIngestionSourceHealthResponse404 | ReadCliIngestionSourceHealthResponse409 | ReadCliIngestionSourceHealthResponse412 | ReadCliIngestionSourceHealthResponse500
    """

    return sync_detailed(
        source_id=source_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    ReadCliIngestionSourceHealthResponse200
    | ReadCliIngestionSourceHealthResponse400
    | ReadCliIngestionSourceHealthResponse401
    | ReadCliIngestionSourceHealthResponse402
    | ReadCliIngestionSourceHealthResponse403
    | ReadCliIngestionSourceHealthResponse404
    | ReadCliIngestionSourceHealthResponse409
    | ReadCliIngestionSourceHealthResponse412
    | ReadCliIngestionSourceHealthResponse500
]:
    """
    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadCliIngestionSourceHealthResponse200 | ReadCliIngestionSourceHealthResponse400 | ReadCliIngestionSourceHealthResponse401 | ReadCliIngestionSourceHealthResponse402 | ReadCliIngestionSourceHealthResponse403 | ReadCliIngestionSourceHealthResponse404 | ReadCliIngestionSourceHealthResponse409 | ReadCliIngestionSourceHealthResponse412 | ReadCliIngestionSourceHealthResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    ReadCliIngestionSourceHealthResponse200
    | ReadCliIngestionSourceHealthResponse400
    | ReadCliIngestionSourceHealthResponse401
    | ReadCliIngestionSourceHealthResponse402
    | ReadCliIngestionSourceHealthResponse403
    | ReadCliIngestionSourceHealthResponse404
    | ReadCliIngestionSourceHealthResponse409
    | ReadCliIngestionSourceHealthResponse412
    | ReadCliIngestionSourceHealthResponse500
    | None
):
    """
    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadCliIngestionSourceHealthResponse200 | ReadCliIngestionSourceHealthResponse400 | ReadCliIngestionSourceHealthResponse401 | ReadCliIngestionSourceHealthResponse402 | ReadCliIngestionSourceHealthResponse403 | ReadCliIngestionSourceHealthResponse404 | ReadCliIngestionSourceHealthResponse409 | ReadCliIngestionSourceHealthResponse412 | ReadCliIngestionSourceHealthResponse500
    """

    return (
        await asyncio_detailed(
            source_id=source_id,
            client=client,
        )
    ).parsed
