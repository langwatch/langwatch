from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_registry_ard_manifest_response_200 import (
    GetApiGovernanceRegistryArdManifestResponse200,
)
from ...models.get_api_governance_registry_ard_manifest_response_400 import (
    GetApiGovernanceRegistryArdManifestResponse400,
)
from ...models.get_api_governance_registry_ard_manifest_response_401 import (
    GetApiGovernanceRegistryArdManifestResponse401,
)
from ...models.get_api_governance_registry_ard_manifest_response_403 import (
    GetApiGovernanceRegistryArdManifestResponse403,
)
from ...models.get_api_governance_registry_ard_manifest_response_500 import (
    GetApiGovernanceRegistryArdManifestResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/registry/ard.json",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceRegistryArdManifestResponse200
    | GetApiGovernanceRegistryArdManifestResponse400
    | GetApiGovernanceRegistryArdManifestResponse401
    | GetApiGovernanceRegistryArdManifestResponse403
    | GetApiGovernanceRegistryArdManifestResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceRegistryArdManifestResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceRegistryArdManifestResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceRegistryArdManifestResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceRegistryArdManifestResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGovernanceRegistryArdManifestResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceRegistryArdManifestResponse200
    | GetApiGovernanceRegistryArdManifestResponse400
    | GetApiGovernanceRegistryArdManifestResponse401
    | GetApiGovernanceRegistryArdManifestResponse403
    | GetApiGovernanceRegistryArdManifestResponse500
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
    GetApiGovernanceRegistryArdManifestResponse200
    | GetApiGovernanceRegistryArdManifestResponse400
    | GetApiGovernanceRegistryArdManifestResponse401
    | GetApiGovernanceRegistryArdManifestResponse403
    | GetApiGovernanceRegistryArdManifestResponse500
]:
    """Get the registry as an ARD manifest

     The organisation's active agents, the 1,000 changed most recently, as an Agentic Resource Discovery
    (ARD v0.91) manifest. Each entry has a `urn:air:<host>:<organization id>:agent:<id>` identifier,
    type `application/agent-card+json` and the registry entry inline as `data`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryArdManifestResponse200 | GetApiGovernanceRegistryArdManifestResponse400 | GetApiGovernanceRegistryArdManifestResponse401 | GetApiGovernanceRegistryArdManifestResponse403 | GetApiGovernanceRegistryArdManifestResponse500]
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
    GetApiGovernanceRegistryArdManifestResponse200
    | GetApiGovernanceRegistryArdManifestResponse400
    | GetApiGovernanceRegistryArdManifestResponse401
    | GetApiGovernanceRegistryArdManifestResponse403
    | GetApiGovernanceRegistryArdManifestResponse500
    | None
):
    """Get the registry as an ARD manifest

     The organisation's active agents, the 1,000 changed most recently, as an Agentic Resource Discovery
    (ARD v0.91) manifest. Each entry has a `urn:air:<host>:<organization id>:agent:<id>` identifier,
    type `application/agent-card+json` and the registry entry inline as `data`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryArdManifestResponse200 | GetApiGovernanceRegistryArdManifestResponse400 | GetApiGovernanceRegistryArdManifestResponse401 | GetApiGovernanceRegistryArdManifestResponse403 | GetApiGovernanceRegistryArdManifestResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceRegistryArdManifestResponse200
    | GetApiGovernanceRegistryArdManifestResponse400
    | GetApiGovernanceRegistryArdManifestResponse401
    | GetApiGovernanceRegistryArdManifestResponse403
    | GetApiGovernanceRegistryArdManifestResponse500
]:
    """Get the registry as an ARD manifest

     The organisation's active agents, the 1,000 changed most recently, as an Agentic Resource Discovery
    (ARD v0.91) manifest. Each entry has a `urn:air:<host>:<organization id>:agent:<id>` identifier,
    type `application/agent-card+json` and the registry entry inline as `data`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistryArdManifestResponse200 | GetApiGovernanceRegistryArdManifestResponse400 | GetApiGovernanceRegistryArdManifestResponse401 | GetApiGovernanceRegistryArdManifestResponse403 | GetApiGovernanceRegistryArdManifestResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceRegistryArdManifestResponse200
    | GetApiGovernanceRegistryArdManifestResponse400
    | GetApiGovernanceRegistryArdManifestResponse401
    | GetApiGovernanceRegistryArdManifestResponse403
    | GetApiGovernanceRegistryArdManifestResponse500
    | None
):
    """Get the registry as an ARD manifest

     The organisation's active agents, the 1,000 changed most recently, as an Agentic Resource Discovery
    (ARD v0.91) manifest. Each entry has a `urn:air:<host>:<organization id>:agent:<id>` identifier,
    type `application/agent-card+json` and the registry entry inline as `data`.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistryArdManifestResponse200 | GetApiGovernanceRegistryArdManifestResponse400 | GetApiGovernanceRegistryArdManifestResponse401 | GetApiGovernanceRegistryArdManifestResponse403 | GetApiGovernanceRegistryArdManifestResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
