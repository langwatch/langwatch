from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_cli_ingestion_templates_response_200 import ListCliIngestionTemplatesResponse200
from ...models.list_cli_ingestion_templates_response_400 import ListCliIngestionTemplatesResponse400
from ...models.list_cli_ingestion_templates_response_401 import ListCliIngestionTemplatesResponse401
from ...models.list_cli_ingestion_templates_response_402 import ListCliIngestionTemplatesResponse402
from ...models.list_cli_ingestion_templates_response_403 import ListCliIngestionTemplatesResponse403
from ...models.list_cli_ingestion_templates_response_404 import ListCliIngestionTemplatesResponse404
from ...models.list_cli_ingestion_templates_response_409 import ListCliIngestionTemplatesResponse409
from ...models.list_cli_ingestion_templates_response_412 import ListCliIngestionTemplatesResponse412
from ...models.list_cli_ingestion_templates_response_500 import ListCliIngestionTemplatesResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/cli/governance/ingestion-templates",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ListCliIngestionTemplatesResponse200
    | ListCliIngestionTemplatesResponse400
    | ListCliIngestionTemplatesResponse401
    | ListCliIngestionTemplatesResponse402
    | ListCliIngestionTemplatesResponse403
    | ListCliIngestionTemplatesResponse404
    | ListCliIngestionTemplatesResponse409
    | ListCliIngestionTemplatesResponse412
    | ListCliIngestionTemplatesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = ListCliIngestionTemplatesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ListCliIngestionTemplatesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ListCliIngestionTemplatesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ListCliIngestionTemplatesResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 403:
        response_403 = ListCliIngestionTemplatesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ListCliIngestionTemplatesResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = ListCliIngestionTemplatesResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 412:
        response_412 = ListCliIngestionTemplatesResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = ListCliIngestionTemplatesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ListCliIngestionTemplatesResponse200
    | ListCliIngestionTemplatesResponse400
    | ListCliIngestionTemplatesResponse401
    | ListCliIngestionTemplatesResponse402
    | ListCliIngestionTemplatesResponse403
    | ListCliIngestionTemplatesResponse404
    | ListCliIngestionTemplatesResponse409
    | ListCliIngestionTemplatesResponse412
    | ListCliIngestionTemplatesResponse500
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
) -> Response[
    ListCliIngestionTemplatesResponse200
    | ListCliIngestionTemplatesResponse400
    | ListCliIngestionTemplatesResponse401
    | ListCliIngestionTemplatesResponse402
    | ListCliIngestionTemplatesResponse403
    | ListCliIngestionTemplatesResponse404
    | ListCliIngestionTemplatesResponse409
    | ListCliIngestionTemplatesResponse412
    | ListCliIngestionTemplatesResponse500
]:
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListCliIngestionTemplatesResponse200 | ListCliIngestionTemplatesResponse400 | ListCliIngestionTemplatesResponse401 | ListCliIngestionTemplatesResponse402 | ListCliIngestionTemplatesResponse403 | ListCliIngestionTemplatesResponse404 | ListCliIngestionTemplatesResponse409 | ListCliIngestionTemplatesResponse412 | ListCliIngestionTemplatesResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    ListCliIngestionTemplatesResponse200
    | ListCliIngestionTemplatesResponse400
    | ListCliIngestionTemplatesResponse401
    | ListCliIngestionTemplatesResponse402
    | ListCliIngestionTemplatesResponse403
    | ListCliIngestionTemplatesResponse404
    | ListCliIngestionTemplatesResponse409
    | ListCliIngestionTemplatesResponse412
    | ListCliIngestionTemplatesResponse500
    | None
):
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListCliIngestionTemplatesResponse200 | ListCliIngestionTemplatesResponse400 | ListCliIngestionTemplatesResponse401 | ListCliIngestionTemplatesResponse402 | ListCliIngestionTemplatesResponse403 | ListCliIngestionTemplatesResponse404 | ListCliIngestionTemplatesResponse409 | ListCliIngestionTemplatesResponse412 | ListCliIngestionTemplatesResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    ListCliIngestionTemplatesResponse200
    | ListCliIngestionTemplatesResponse400
    | ListCliIngestionTemplatesResponse401
    | ListCliIngestionTemplatesResponse402
    | ListCliIngestionTemplatesResponse403
    | ListCliIngestionTemplatesResponse404
    | ListCliIngestionTemplatesResponse409
    | ListCliIngestionTemplatesResponse412
    | ListCliIngestionTemplatesResponse500
]:
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListCliIngestionTemplatesResponse200 | ListCliIngestionTemplatesResponse400 | ListCliIngestionTemplatesResponse401 | ListCliIngestionTemplatesResponse402 | ListCliIngestionTemplatesResponse403 | ListCliIngestionTemplatesResponse404 | ListCliIngestionTemplatesResponse409 | ListCliIngestionTemplatesResponse412 | ListCliIngestionTemplatesResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    ListCliIngestionTemplatesResponse200
    | ListCliIngestionTemplatesResponse400
    | ListCliIngestionTemplatesResponse401
    | ListCliIngestionTemplatesResponse402
    | ListCliIngestionTemplatesResponse403
    | ListCliIngestionTemplatesResponse404
    | ListCliIngestionTemplatesResponse409
    | ListCliIngestionTemplatesResponse412
    | ListCliIngestionTemplatesResponse500
    | None
):
    """
    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListCliIngestionTemplatesResponse200 | ListCliIngestionTemplatesResponse400 | ListCliIngestionTemplatesResponse401 | ListCliIngestionTemplatesResponse402 | ListCliIngestionTemplatesResponse403 | ListCliIngestionTemplatesResponse404 | ListCliIngestionTemplatesResponse409 | ListCliIngestionTemplatesResponse412 | ListCliIngestionTemplatesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
