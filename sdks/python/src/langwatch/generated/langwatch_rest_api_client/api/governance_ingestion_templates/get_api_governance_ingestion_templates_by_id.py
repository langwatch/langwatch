from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_ingestion_templates_by_id_response_200 import (
    GetApiGovernanceIngestionTemplatesByIdResponse200,
)
from ...models.get_api_governance_ingestion_templates_by_id_response_400 import (
    GetApiGovernanceIngestionTemplatesByIdResponse400,
)
from ...models.get_api_governance_ingestion_templates_by_id_response_401 import (
    GetApiGovernanceIngestionTemplatesByIdResponse401,
)
from ...models.get_api_governance_ingestion_templates_by_id_response_404 import (
    GetApiGovernanceIngestionTemplatesByIdResponse404,
)
from ...models.get_api_governance_ingestion_templates_by_id_response_422 import (
    GetApiGovernanceIngestionTemplatesByIdResponse422,
)
from ...models.get_api_governance_ingestion_templates_by_id_response_500 import (
    GetApiGovernanceIngestionTemplatesByIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/governance/ingestion-templates/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceIngestionTemplatesByIdResponse200
    | GetApiGovernanceIngestionTemplatesByIdResponse400
    | GetApiGovernanceIngestionTemplatesByIdResponse401
    | GetApiGovernanceIngestionTemplatesByIdResponse404
    | GetApiGovernanceIngestionTemplatesByIdResponse422
    | GetApiGovernanceIngestionTemplatesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceIngestionTemplatesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceIngestionTemplatesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceIngestionTemplatesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiGovernanceIngestionTemplatesByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiGovernanceIngestionTemplatesByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceIngestionTemplatesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceIngestionTemplatesByIdResponse200
    | GetApiGovernanceIngestionTemplatesByIdResponse400
    | GetApiGovernanceIngestionTemplatesByIdResponse401
    | GetApiGovernanceIngestionTemplatesByIdResponse404
    | GetApiGovernanceIngestionTemplatesByIdResponse422
    | GetApiGovernanceIngestionTemplatesByIdResponse500
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
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiGovernanceIngestionTemplatesByIdResponse200
    | GetApiGovernanceIngestionTemplatesByIdResponse400
    | GetApiGovernanceIngestionTemplatesByIdResponse401
    | GetApiGovernanceIngestionTemplatesByIdResponse404
    | GetApiGovernanceIngestionTemplatesByIdResponse422
    | GetApiGovernanceIngestionTemplatesByIdResponse500
]:
    """Get ingestion template

     Single-template lookup by id, scoped to the caller's organization. Cross-org probes collapse to 404
    (no enumeration vector).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceIngestionTemplatesByIdResponse200 | GetApiGovernanceIngestionTemplatesByIdResponse400 | GetApiGovernanceIngestionTemplatesByIdResponse401 | GetApiGovernanceIngestionTemplatesByIdResponse404 | GetApiGovernanceIngestionTemplatesByIdResponse422 | GetApiGovernanceIngestionTemplatesByIdResponse500]
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
    client: AuthenticatedClient | Client,
) -> (
    GetApiGovernanceIngestionTemplatesByIdResponse200
    | GetApiGovernanceIngestionTemplatesByIdResponse400
    | GetApiGovernanceIngestionTemplatesByIdResponse401
    | GetApiGovernanceIngestionTemplatesByIdResponse404
    | GetApiGovernanceIngestionTemplatesByIdResponse422
    | GetApiGovernanceIngestionTemplatesByIdResponse500
    | None
):
    """Get ingestion template

     Single-template lookup by id, scoped to the caller's organization. Cross-org probes collapse to 404
    (no enumeration vector).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceIngestionTemplatesByIdResponse200 | GetApiGovernanceIngestionTemplatesByIdResponse400 | GetApiGovernanceIngestionTemplatesByIdResponse401 | GetApiGovernanceIngestionTemplatesByIdResponse404 | GetApiGovernanceIngestionTemplatesByIdResponse422 | GetApiGovernanceIngestionTemplatesByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiGovernanceIngestionTemplatesByIdResponse200
    | GetApiGovernanceIngestionTemplatesByIdResponse400
    | GetApiGovernanceIngestionTemplatesByIdResponse401
    | GetApiGovernanceIngestionTemplatesByIdResponse404
    | GetApiGovernanceIngestionTemplatesByIdResponse422
    | GetApiGovernanceIngestionTemplatesByIdResponse500
]:
    """Get ingestion template

     Single-template lookup by id, scoped to the caller's organization. Cross-org probes collapse to 404
    (no enumeration vector).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceIngestionTemplatesByIdResponse200 | GetApiGovernanceIngestionTemplatesByIdResponse400 | GetApiGovernanceIngestionTemplatesByIdResponse401 | GetApiGovernanceIngestionTemplatesByIdResponse404 | GetApiGovernanceIngestionTemplatesByIdResponse422 | GetApiGovernanceIngestionTemplatesByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiGovernanceIngestionTemplatesByIdResponse200
    | GetApiGovernanceIngestionTemplatesByIdResponse400
    | GetApiGovernanceIngestionTemplatesByIdResponse401
    | GetApiGovernanceIngestionTemplatesByIdResponse404
    | GetApiGovernanceIngestionTemplatesByIdResponse422
    | GetApiGovernanceIngestionTemplatesByIdResponse500
    | None
):
    """Get ingestion template

     Single-template lookup by id, scoped to the caller's organization. Cross-org probes collapse to 404
    (no enumeration vector).

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceIngestionTemplatesByIdResponse200 | GetApiGovernanceIngestionTemplatesByIdResponse400 | GetApiGovernanceIngestionTemplatesByIdResponse401 | GetApiGovernanceIngestionTemplatesByIdResponse404 | GetApiGovernanceIngestionTemplatesByIdResponse422 | GetApiGovernanceIngestionTemplatesByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
