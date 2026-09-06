from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_ingestion_templates_admin_response_200 import (
    GetApiGovernanceIngestionTemplatesAdminResponse200,
)
from ...models.get_api_governance_ingestion_templates_admin_response_400 import (
    GetApiGovernanceIngestionTemplatesAdminResponse400,
)
from ...models.get_api_governance_ingestion_templates_admin_response_401 import (
    GetApiGovernanceIngestionTemplatesAdminResponse401,
)
from ...models.get_api_governance_ingestion_templates_admin_response_422 import (
    GetApiGovernanceIngestionTemplatesAdminResponse422,
)
from ...models.get_api_governance_ingestion_templates_admin_response_500 import (
    GetApiGovernanceIngestionTemplatesAdminResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/governance/ingestion-templates/admin",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceIngestionTemplatesAdminResponse200
    | GetApiGovernanceIngestionTemplatesAdminResponse400
    | GetApiGovernanceIngestionTemplatesAdminResponse401
    | GetApiGovernanceIngestionTemplatesAdminResponse422
    | GetApiGovernanceIngestionTemplatesAdminResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceIngestionTemplatesAdminResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceIngestionTemplatesAdminResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceIngestionTemplatesAdminResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiGovernanceIngestionTemplatesAdminResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiGovernanceIngestionTemplatesAdminResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceIngestionTemplatesAdminResponse200
    | GetApiGovernanceIngestionTemplatesAdminResponse400
    | GetApiGovernanceIngestionTemplatesAdminResponse401
    | GetApiGovernanceIngestionTemplatesAdminResponse422
    | GetApiGovernanceIngestionTemplatesAdminResponse500
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
    GetApiGovernanceIngestionTemplatesAdminResponse200
    | GetApiGovernanceIngestionTemplatesAdminResponse400
    | GetApiGovernanceIngestionTemplatesAdminResponse401
    | GetApiGovernanceIngestionTemplatesAdminResponse422
    | GetApiGovernanceIngestionTemplatesAdminResponse500
]:
    """List ingestion templates (admin shape, includes OTTL)

     Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by
    admin tooling to render the transparency block / authoring drawer.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceIngestionTemplatesAdminResponse200 | GetApiGovernanceIngestionTemplatesAdminResponse400 | GetApiGovernanceIngestionTemplatesAdminResponse401 | GetApiGovernanceIngestionTemplatesAdminResponse422 | GetApiGovernanceIngestionTemplatesAdminResponse500]
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
    GetApiGovernanceIngestionTemplatesAdminResponse200
    | GetApiGovernanceIngestionTemplatesAdminResponse400
    | GetApiGovernanceIngestionTemplatesAdminResponse401
    | GetApiGovernanceIngestionTemplatesAdminResponse422
    | GetApiGovernanceIngestionTemplatesAdminResponse500
    | None
):
    """List ingestion templates (admin shape, includes OTTL)

     Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by
    admin tooling to render the transparency block / authoring drawer.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceIngestionTemplatesAdminResponse200 | GetApiGovernanceIngestionTemplatesAdminResponse400 | GetApiGovernanceIngestionTemplatesAdminResponse401 | GetApiGovernanceIngestionTemplatesAdminResponse422 | GetApiGovernanceIngestionTemplatesAdminResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceIngestionTemplatesAdminResponse200
    | GetApiGovernanceIngestionTemplatesAdminResponse400
    | GetApiGovernanceIngestionTemplatesAdminResponse401
    | GetApiGovernanceIngestionTemplatesAdminResponse422
    | GetApiGovernanceIngestionTemplatesAdminResponse500
]:
    """List ingestion templates (admin shape, includes OTTL)

     Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by
    admin tooling to render the transparency block / authoring drawer.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceIngestionTemplatesAdminResponse200 | GetApiGovernanceIngestionTemplatesAdminResponse400 | GetApiGovernanceIngestionTemplatesAdminResponse401 | GetApiGovernanceIngestionTemplatesAdminResponse422 | GetApiGovernanceIngestionTemplatesAdminResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceIngestionTemplatesAdminResponse200
    | GetApiGovernanceIngestionTemplatesAdminResponse400
    | GetApiGovernanceIngestionTemplatesAdminResponse401
    | GetApiGovernanceIngestionTemplatesAdminResponse422
    | GetApiGovernanceIngestionTemplatesAdminResponse500
    | None
):
    """List ingestion templates (admin shape, includes OTTL)

     Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by
    admin tooling to render the transparency block / authoring drawer.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceIngestionTemplatesAdminResponse200 | GetApiGovernanceIngestionTemplatesAdminResponse400 | GetApiGovernanceIngestionTemplatesAdminResponse401 | GetApiGovernanceIngestionTemplatesAdminResponse422 | GetApiGovernanceIngestionTemplatesAdminResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
