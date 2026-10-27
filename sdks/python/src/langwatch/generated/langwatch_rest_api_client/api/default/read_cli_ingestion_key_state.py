from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.read_cli_ingestion_key_state_response_200 import ReadCliIngestionKeyStateResponse200
from ...models.read_cli_ingestion_key_state_response_400 import ReadCliIngestionKeyStateResponse400
from ...models.read_cli_ingestion_key_state_response_401 import ReadCliIngestionKeyStateResponse401
from ...models.read_cli_ingestion_key_state_response_402 import ReadCliIngestionKeyStateResponse402
from ...models.read_cli_ingestion_key_state_response_403 import ReadCliIngestionKeyStateResponse403
from ...models.read_cli_ingestion_key_state_response_404 import ReadCliIngestionKeyStateResponse404
from ...models.read_cli_ingestion_key_state_response_409 import ReadCliIngestionKeyStateResponse409
from ...models.read_cli_ingestion_key_state_response_412 import ReadCliIngestionKeyStateResponse412
from ...models.read_cli_ingestion_key_state_response_500 import ReadCliIngestionKeyStateResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    lookup_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/cli/governance/ingestion-keys/{lookup_id}".format(
            lookup_id=quote(str(lookup_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ReadCliIngestionKeyStateResponse200
    | ReadCliIngestionKeyStateResponse400
    | ReadCliIngestionKeyStateResponse401
    | ReadCliIngestionKeyStateResponse402
    | ReadCliIngestionKeyStateResponse403
    | ReadCliIngestionKeyStateResponse404
    | ReadCliIngestionKeyStateResponse409
    | ReadCliIngestionKeyStateResponse412
    | ReadCliIngestionKeyStateResponse500
    | None
):
    if response.status_code == 200:
        response_200 = ReadCliIngestionKeyStateResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ReadCliIngestionKeyStateResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ReadCliIngestionKeyStateResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ReadCliIngestionKeyStateResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 403:
        response_403 = ReadCliIngestionKeyStateResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ReadCliIngestionKeyStateResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ReadCliIngestionKeyStateResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 412:
        response_412 = ReadCliIngestionKeyStateResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = ReadCliIngestionKeyStateResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ReadCliIngestionKeyStateResponse200
    | ReadCliIngestionKeyStateResponse400
    | ReadCliIngestionKeyStateResponse401
    | ReadCliIngestionKeyStateResponse402
    | ReadCliIngestionKeyStateResponse403
    | ReadCliIngestionKeyStateResponse404
    | ReadCliIngestionKeyStateResponse409
    | ReadCliIngestionKeyStateResponse412
    | ReadCliIngestionKeyStateResponse500
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
    lookup_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    ReadCliIngestionKeyStateResponse200
    | ReadCliIngestionKeyStateResponse400
    | ReadCliIngestionKeyStateResponse401
    | ReadCliIngestionKeyStateResponse402
    | ReadCliIngestionKeyStateResponse403
    | ReadCliIngestionKeyStateResponse404
    | ReadCliIngestionKeyStateResponse409
    | ReadCliIngestionKeyStateResponse412
    | ReadCliIngestionKeyStateResponse500
]:
    """
    Args:
        lookup_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadCliIngestionKeyStateResponse200 | ReadCliIngestionKeyStateResponse400 | ReadCliIngestionKeyStateResponse401 | ReadCliIngestionKeyStateResponse402 | ReadCliIngestionKeyStateResponse403 | ReadCliIngestionKeyStateResponse404 | ReadCliIngestionKeyStateResponse409 | ReadCliIngestionKeyStateResponse412 | ReadCliIngestionKeyStateResponse500]
    """

    kwargs = _get_kwargs(
        lookup_id=lookup_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    lookup_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    ReadCliIngestionKeyStateResponse200
    | ReadCliIngestionKeyStateResponse400
    | ReadCliIngestionKeyStateResponse401
    | ReadCliIngestionKeyStateResponse402
    | ReadCliIngestionKeyStateResponse403
    | ReadCliIngestionKeyStateResponse404
    | ReadCliIngestionKeyStateResponse409
    | ReadCliIngestionKeyStateResponse412
    | ReadCliIngestionKeyStateResponse500
    | None
):
    """
    Args:
        lookup_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadCliIngestionKeyStateResponse200 | ReadCliIngestionKeyStateResponse400 | ReadCliIngestionKeyStateResponse401 | ReadCliIngestionKeyStateResponse402 | ReadCliIngestionKeyStateResponse403 | ReadCliIngestionKeyStateResponse404 | ReadCliIngestionKeyStateResponse409 | ReadCliIngestionKeyStateResponse412 | ReadCliIngestionKeyStateResponse500
    """

    return sync_detailed(
        lookup_id=lookup_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    lookup_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    ReadCliIngestionKeyStateResponse200
    | ReadCliIngestionKeyStateResponse400
    | ReadCliIngestionKeyStateResponse401
    | ReadCliIngestionKeyStateResponse402
    | ReadCliIngestionKeyStateResponse403
    | ReadCliIngestionKeyStateResponse404
    | ReadCliIngestionKeyStateResponse409
    | ReadCliIngestionKeyStateResponse412
    | ReadCliIngestionKeyStateResponse500
]:
    """
    Args:
        lookup_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReadCliIngestionKeyStateResponse200 | ReadCliIngestionKeyStateResponse400 | ReadCliIngestionKeyStateResponse401 | ReadCliIngestionKeyStateResponse402 | ReadCliIngestionKeyStateResponse403 | ReadCliIngestionKeyStateResponse404 | ReadCliIngestionKeyStateResponse409 | ReadCliIngestionKeyStateResponse412 | ReadCliIngestionKeyStateResponse500]
    """

    kwargs = _get_kwargs(
        lookup_id=lookup_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    lookup_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    ReadCliIngestionKeyStateResponse200
    | ReadCliIngestionKeyStateResponse400
    | ReadCliIngestionKeyStateResponse401
    | ReadCliIngestionKeyStateResponse402
    | ReadCliIngestionKeyStateResponse403
    | ReadCliIngestionKeyStateResponse404
    | ReadCliIngestionKeyStateResponse409
    | ReadCliIngestionKeyStateResponse412
    | ReadCliIngestionKeyStateResponse500
    | None
):
    """
    Args:
        lookup_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReadCliIngestionKeyStateResponse200 | ReadCliIngestionKeyStateResponse400 | ReadCliIngestionKeyStateResponse401 | ReadCliIngestionKeyStateResponse402 | ReadCliIngestionKeyStateResponse403 | ReadCliIngestionKeyStateResponse404 | ReadCliIngestionKeyStateResponse409 | ReadCliIngestionKeyStateResponse412 | ReadCliIngestionKeyStateResponse500
    """

    return (
        await asyncio_detailed(
            lookup_id=lookup_id,
            client=client,
        )
    ).parsed
