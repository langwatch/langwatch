from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_cli_ingestion_source_events_response_200 import ListCliIngestionSourceEventsResponse200
from ...models.list_cli_ingestion_source_events_response_400 import ListCliIngestionSourceEventsResponse400
from ...models.list_cli_ingestion_source_events_response_401 import ListCliIngestionSourceEventsResponse401
from ...models.list_cli_ingestion_source_events_response_402 import ListCliIngestionSourceEventsResponse402
from ...models.list_cli_ingestion_source_events_response_403 import ListCliIngestionSourceEventsResponse403
from ...models.list_cli_ingestion_source_events_response_404 import ListCliIngestionSourceEventsResponse404
from ...models.list_cli_ingestion_source_events_response_409 import ListCliIngestionSourceEventsResponse409
from ...models.list_cli_ingestion_source_events_response_412 import ListCliIngestionSourceEventsResponse412
from ...models.list_cli_ingestion_source_events_response_500 import ListCliIngestionSourceEventsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    source_id: str,
    *,
    limit: str | Unset = UNSET,
    before_iso: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["before_iso"] = before_iso

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/cli/governance/ingest/sources/{source_id}/events".format(
            source_id=quote(str(source_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ListCliIngestionSourceEventsResponse200
    | ListCliIngestionSourceEventsResponse400
    | ListCliIngestionSourceEventsResponse401
    | ListCliIngestionSourceEventsResponse402
    | ListCliIngestionSourceEventsResponse403
    | ListCliIngestionSourceEventsResponse404
    | ListCliIngestionSourceEventsResponse409
    | ListCliIngestionSourceEventsResponse412
    | ListCliIngestionSourceEventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = ListCliIngestionSourceEventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ListCliIngestionSourceEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ListCliIngestionSourceEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ListCliIngestionSourceEventsResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 403:
        response_403 = ListCliIngestionSourceEventsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ListCliIngestionSourceEventsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ListCliIngestionSourceEventsResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 412:
        response_412 = ListCliIngestionSourceEventsResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = ListCliIngestionSourceEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ListCliIngestionSourceEventsResponse200
    | ListCliIngestionSourceEventsResponse400
    | ListCliIngestionSourceEventsResponse401
    | ListCliIngestionSourceEventsResponse402
    | ListCliIngestionSourceEventsResponse403
    | ListCliIngestionSourceEventsResponse404
    | ListCliIngestionSourceEventsResponse409
    | ListCliIngestionSourceEventsResponse412
    | ListCliIngestionSourceEventsResponse500
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
    limit: str | Unset = UNSET,
    before_iso: str | Unset = UNSET,
) -> Response[
    ListCliIngestionSourceEventsResponse200
    | ListCliIngestionSourceEventsResponse400
    | ListCliIngestionSourceEventsResponse401
    | ListCliIngestionSourceEventsResponse402
    | ListCliIngestionSourceEventsResponse403
    | ListCliIngestionSourceEventsResponse404
    | ListCliIngestionSourceEventsResponse409
    | ListCliIngestionSourceEventsResponse412
    | ListCliIngestionSourceEventsResponse500
]:
    """
    Args:
        source_id (str):
        limit (str | Unset):
        before_iso (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListCliIngestionSourceEventsResponse200 | ListCliIngestionSourceEventsResponse400 | ListCliIngestionSourceEventsResponse401 | ListCliIngestionSourceEventsResponse402 | ListCliIngestionSourceEventsResponse403 | ListCliIngestionSourceEventsResponse404 | ListCliIngestionSourceEventsResponse409 | ListCliIngestionSourceEventsResponse412 | ListCliIngestionSourceEventsResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
        limit=limit,
        before_iso=before_iso,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    source_id: str,
    *,
    client: AuthenticatedClient,
    limit: str | Unset = UNSET,
    before_iso: str | Unset = UNSET,
) -> (
    ListCliIngestionSourceEventsResponse200
    | ListCliIngestionSourceEventsResponse400
    | ListCliIngestionSourceEventsResponse401
    | ListCliIngestionSourceEventsResponse402
    | ListCliIngestionSourceEventsResponse403
    | ListCliIngestionSourceEventsResponse404
    | ListCliIngestionSourceEventsResponse409
    | ListCliIngestionSourceEventsResponse412
    | ListCliIngestionSourceEventsResponse500
    | None
):
    """
    Args:
        source_id (str):
        limit (str | Unset):
        before_iso (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListCliIngestionSourceEventsResponse200 | ListCliIngestionSourceEventsResponse400 | ListCliIngestionSourceEventsResponse401 | ListCliIngestionSourceEventsResponse402 | ListCliIngestionSourceEventsResponse403 | ListCliIngestionSourceEventsResponse404 | ListCliIngestionSourceEventsResponse409 | ListCliIngestionSourceEventsResponse412 | ListCliIngestionSourceEventsResponse500
    """

    return sync_detailed(
        source_id=source_id,
        client=client,
        limit=limit,
        before_iso=before_iso,
    ).parsed


async def asyncio_detailed(
    source_id: str,
    *,
    client: AuthenticatedClient,
    limit: str | Unset = UNSET,
    before_iso: str | Unset = UNSET,
) -> Response[
    ListCliIngestionSourceEventsResponse200
    | ListCliIngestionSourceEventsResponse400
    | ListCliIngestionSourceEventsResponse401
    | ListCliIngestionSourceEventsResponse402
    | ListCliIngestionSourceEventsResponse403
    | ListCliIngestionSourceEventsResponse404
    | ListCliIngestionSourceEventsResponse409
    | ListCliIngestionSourceEventsResponse412
    | ListCliIngestionSourceEventsResponse500
]:
    """
    Args:
        source_id (str):
        limit (str | Unset):
        before_iso (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListCliIngestionSourceEventsResponse200 | ListCliIngestionSourceEventsResponse400 | ListCliIngestionSourceEventsResponse401 | ListCliIngestionSourceEventsResponse402 | ListCliIngestionSourceEventsResponse403 | ListCliIngestionSourceEventsResponse404 | ListCliIngestionSourceEventsResponse409 | ListCliIngestionSourceEventsResponse412 | ListCliIngestionSourceEventsResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
        limit=limit,
        before_iso=before_iso,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    source_id: str,
    *,
    client: AuthenticatedClient,
    limit: str | Unset = UNSET,
    before_iso: str | Unset = UNSET,
) -> (
    ListCliIngestionSourceEventsResponse200
    | ListCliIngestionSourceEventsResponse400
    | ListCliIngestionSourceEventsResponse401
    | ListCliIngestionSourceEventsResponse402
    | ListCliIngestionSourceEventsResponse403
    | ListCliIngestionSourceEventsResponse404
    | ListCliIngestionSourceEventsResponse409
    | ListCliIngestionSourceEventsResponse412
    | ListCliIngestionSourceEventsResponse500
    | None
):
    """
    Args:
        source_id (str):
        limit (str | Unset):
        before_iso (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListCliIngestionSourceEventsResponse200 | ListCliIngestionSourceEventsResponse400 | ListCliIngestionSourceEventsResponse401 | ListCliIngestionSourceEventsResponse402 | ListCliIngestionSourceEventsResponse403 | ListCliIngestionSourceEventsResponse404 | ListCliIngestionSourceEventsResponse409 | ListCliIngestionSourceEventsResponse412 | ListCliIngestionSourceEventsResponse500
    """

    return (
        await asyncio_detailed(
            source_id=source_id,
            client=client,
            limit=limit,
            before_iso=before_iso,
        )
    ).parsed
