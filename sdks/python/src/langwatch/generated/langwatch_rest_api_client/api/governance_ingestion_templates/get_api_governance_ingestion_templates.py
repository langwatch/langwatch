from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_ingestion_templates_response_200 import GetApiGovernanceIngestionTemplatesResponse200
from ...models.get_api_governance_ingestion_templates_response_400 import GetApiGovernanceIngestionTemplatesResponse400
from ...models.get_api_governance_ingestion_templates_response_401 import GetApiGovernanceIngestionTemplatesResponse401
from ...models.get_api_governance_ingestion_templates_response_422 import GetApiGovernanceIngestionTemplatesResponse422
from ...models.get_api_governance_ingestion_templates_response_500 import GetApiGovernanceIngestionTemplatesResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/governance/ingestion-templates",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceIngestionTemplatesResponse200
    | GetApiGovernanceIngestionTemplatesResponse400
    | GetApiGovernanceIngestionTemplatesResponse401
    | GetApiGovernanceIngestionTemplatesResponse422
    | GetApiGovernanceIngestionTemplatesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceIngestionTemplatesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceIngestionTemplatesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceIngestionTemplatesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiGovernanceIngestionTemplatesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceIngestionTemplatesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceIngestionTemplatesResponse200
    | GetApiGovernanceIngestionTemplatesResponse400
    | GetApiGovernanceIngestionTemplatesResponse401
    | GetApiGovernanceIngestionTemplatesResponse422
    | GetApiGovernanceIngestionTemplatesResponse500
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
    GetApiGovernanceIngestionTemplatesResponse200
    | GetApiGovernanceIngestionTemplatesResponse400
    | GetApiGovernanceIngestionTemplatesResponse401
    | GetApiGovernanceIngestionTemplatesResponse422
    | GetApiGovernanceIngestionTemplatesResponse500
]:
    """List ingestion templates

     Returns the union of platform-published default templates and any org-authored templates visible to
    the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this
    end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceIngestionTemplatesResponse200 | GetApiGovernanceIngestionTemplatesResponse400 | GetApiGovernanceIngestionTemplatesResponse401 | GetApiGovernanceIngestionTemplatesResponse422 | GetApiGovernanceIngestionTemplatesResponse500]
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
    GetApiGovernanceIngestionTemplatesResponse200
    | GetApiGovernanceIngestionTemplatesResponse400
    | GetApiGovernanceIngestionTemplatesResponse401
    | GetApiGovernanceIngestionTemplatesResponse422
    | GetApiGovernanceIngestionTemplatesResponse500
    | None
):
    """List ingestion templates

     Returns the union of platform-published default templates and any org-authored templates visible to
    the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this
    end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceIngestionTemplatesResponse200 | GetApiGovernanceIngestionTemplatesResponse400 | GetApiGovernanceIngestionTemplatesResponse401 | GetApiGovernanceIngestionTemplatesResponse422 | GetApiGovernanceIngestionTemplatesResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceIngestionTemplatesResponse200
    | GetApiGovernanceIngestionTemplatesResponse400
    | GetApiGovernanceIngestionTemplatesResponse401
    | GetApiGovernanceIngestionTemplatesResponse422
    | GetApiGovernanceIngestionTemplatesResponse500
]:
    """List ingestion templates

     Returns the union of platform-published default templates and any org-authored templates visible to
    the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this
    end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceIngestionTemplatesResponse200 | GetApiGovernanceIngestionTemplatesResponse400 | GetApiGovernanceIngestionTemplatesResponse401 | GetApiGovernanceIngestionTemplatesResponse422 | GetApiGovernanceIngestionTemplatesResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceIngestionTemplatesResponse200
    | GetApiGovernanceIngestionTemplatesResponse400
    | GetApiGovernanceIngestionTemplatesResponse401
    | GetApiGovernanceIngestionTemplatesResponse422
    | GetApiGovernanceIngestionTemplatesResponse500
    | None
):
    """List ingestion templates

     Returns the union of platform-published default templates and any org-authored templates visible to
    the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this
    end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceIngestionTemplatesResponse200 | GetApiGovernanceIngestionTemplatesResponse400 | GetApiGovernanceIngestionTemplatesResponse401 | GetApiGovernanceIngestionTemplatesResponse422 | GetApiGovernanceIngestionTemplatesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
