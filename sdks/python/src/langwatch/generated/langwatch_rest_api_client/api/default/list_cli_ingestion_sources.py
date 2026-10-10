from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_cli_ingestion_sources_response_200 import ListCliIngestionSourcesResponse200
from ...models.list_cli_ingestion_sources_response_400 import ListCliIngestionSourcesResponse400
from ...models.list_cli_ingestion_sources_response_401 import ListCliIngestionSourcesResponse401
from ...models.list_cli_ingestion_sources_response_402 import ListCliIngestionSourcesResponse402
from ...models.list_cli_ingestion_sources_response_403 import ListCliIngestionSourcesResponse403
from ...models.list_cli_ingestion_sources_response_404 import ListCliIngestionSourcesResponse404
from ...models.list_cli_ingestion_sources_response_409 import ListCliIngestionSourcesResponse409
from ...models.list_cli_ingestion_sources_response_412 import ListCliIngestionSourcesResponse412
from ...models.list_cli_ingestion_sources_response_500 import ListCliIngestionSourcesResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    include_archived: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["include_archived"] = include_archived

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/cli/governance/ingest/sources",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ListCliIngestionSourcesResponse200
    | ListCliIngestionSourcesResponse400
    | ListCliIngestionSourcesResponse401
    | ListCliIngestionSourcesResponse402
    | ListCliIngestionSourcesResponse403
    | ListCliIngestionSourcesResponse404
    | ListCliIngestionSourcesResponse409
    | ListCliIngestionSourcesResponse412
    | ListCliIngestionSourcesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = ListCliIngestionSourcesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ListCliIngestionSourcesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ListCliIngestionSourcesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ListCliIngestionSourcesResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 403:
        response_403 = ListCliIngestionSourcesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ListCliIngestionSourcesResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ListCliIngestionSourcesResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 412:
        response_412 = ListCliIngestionSourcesResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = ListCliIngestionSourcesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ListCliIngestionSourcesResponse200
    | ListCliIngestionSourcesResponse400
    | ListCliIngestionSourcesResponse401
    | ListCliIngestionSourcesResponse402
    | ListCliIngestionSourcesResponse403
    | ListCliIngestionSourcesResponse404
    | ListCliIngestionSourcesResponse409
    | ListCliIngestionSourcesResponse412
    | ListCliIngestionSourcesResponse500
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
    include_archived: str | Unset = UNSET,
) -> Response[
    ListCliIngestionSourcesResponse200
    | ListCliIngestionSourcesResponse400
    | ListCliIngestionSourcesResponse401
    | ListCliIngestionSourcesResponse402
    | ListCliIngestionSourcesResponse403
    | ListCliIngestionSourcesResponse404
    | ListCliIngestionSourcesResponse409
    | ListCliIngestionSourcesResponse412
    | ListCliIngestionSourcesResponse500
]:
    """
    Args:
        include_archived (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListCliIngestionSourcesResponse200 | ListCliIngestionSourcesResponse400 | ListCliIngestionSourcesResponse401 | ListCliIngestionSourcesResponse402 | ListCliIngestionSourcesResponse403 | ListCliIngestionSourcesResponse404 | ListCliIngestionSourcesResponse409 | ListCliIngestionSourcesResponse412 | ListCliIngestionSourcesResponse500]
    """

    kwargs = _get_kwargs(
        include_archived=include_archived,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    include_archived: str | Unset = UNSET,
) -> (
    ListCliIngestionSourcesResponse200
    | ListCliIngestionSourcesResponse400
    | ListCliIngestionSourcesResponse401
    | ListCliIngestionSourcesResponse402
    | ListCliIngestionSourcesResponse403
    | ListCliIngestionSourcesResponse404
    | ListCliIngestionSourcesResponse409
    | ListCliIngestionSourcesResponse412
    | ListCliIngestionSourcesResponse500
    | None
):
    """
    Args:
        include_archived (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListCliIngestionSourcesResponse200 | ListCliIngestionSourcesResponse400 | ListCliIngestionSourcesResponse401 | ListCliIngestionSourcesResponse402 | ListCliIngestionSourcesResponse403 | ListCliIngestionSourcesResponse404 | ListCliIngestionSourcesResponse409 | ListCliIngestionSourcesResponse412 | ListCliIngestionSourcesResponse500
    """

    return sync_detailed(
        client=client,
        include_archived=include_archived,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    include_archived: str | Unset = UNSET,
) -> Response[
    ListCliIngestionSourcesResponse200
    | ListCliIngestionSourcesResponse400
    | ListCliIngestionSourcesResponse401
    | ListCliIngestionSourcesResponse402
    | ListCliIngestionSourcesResponse403
    | ListCliIngestionSourcesResponse404
    | ListCliIngestionSourcesResponse409
    | ListCliIngestionSourcesResponse412
    | ListCliIngestionSourcesResponse500
]:
    """
    Args:
        include_archived (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListCliIngestionSourcesResponse200 | ListCliIngestionSourcesResponse400 | ListCliIngestionSourcesResponse401 | ListCliIngestionSourcesResponse402 | ListCliIngestionSourcesResponse403 | ListCliIngestionSourcesResponse404 | ListCliIngestionSourcesResponse409 | ListCliIngestionSourcesResponse412 | ListCliIngestionSourcesResponse500]
    """

    kwargs = _get_kwargs(
        include_archived=include_archived,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    include_archived: str | Unset = UNSET,
) -> (
    ListCliIngestionSourcesResponse200
    | ListCliIngestionSourcesResponse400
    | ListCliIngestionSourcesResponse401
    | ListCliIngestionSourcesResponse402
    | ListCliIngestionSourcesResponse403
    | ListCliIngestionSourcesResponse404
    | ListCliIngestionSourcesResponse409
    | ListCliIngestionSourcesResponse412
    | ListCliIngestionSourcesResponse500
    | None
):
    """
    Args:
        include_archived (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListCliIngestionSourcesResponse200 | ListCliIngestionSourcesResponse400 | ListCliIngestionSourcesResponse401 | ListCliIngestionSourcesResponse402 | ListCliIngestionSourcesResponse403 | ListCliIngestionSourcesResponse404 | ListCliIngestionSourcesResponse409 | ListCliIngestionSourcesResponse412 | ListCliIngestionSourcesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            include_archived=include_archived,
        )
    ).parsed
