from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_registry_settings_response_200 import GetApiGovernanceRegistrySettingsResponse200
from ...models.get_api_governance_registry_settings_response_400 import GetApiGovernanceRegistrySettingsResponse400
from ...models.get_api_governance_registry_settings_response_401 import GetApiGovernanceRegistrySettingsResponse401
from ...models.get_api_governance_registry_settings_response_403 import GetApiGovernanceRegistrySettingsResponse403
from ...models.get_api_governance_registry_settings_response_500 import GetApiGovernanceRegistrySettingsResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/registry/settings",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceRegistrySettingsResponse200
    | GetApiGovernanceRegistrySettingsResponse400
    | GetApiGovernanceRegistrySettingsResponse401
    | GetApiGovernanceRegistrySettingsResponse403
    | GetApiGovernanceRegistrySettingsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceRegistrySettingsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceRegistrySettingsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceRegistrySettingsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceRegistrySettingsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGovernanceRegistrySettingsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceRegistrySettingsResponse200
    | GetApiGovernanceRegistrySettingsResponse400
    | GetApiGovernanceRegistrySettingsResponse401
    | GetApiGovernanceRegistrySettingsResponse403
    | GetApiGovernanceRegistrySettingsResponse500
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
    GetApiGovernanceRegistrySettingsResponse200
    | GetApiGovernanceRegistrySettingsResponse400
    | GetApiGovernanceRegistrySettingsResponse401
    | GetApiGovernanceRegistrySettingsResponse403
    | GetApiGovernanceRegistrySettingsResponse500
]:
    """Get the registry settings

     The organisation's dormancy window: the days without a trace after which a listed agent reads as
    `dormant`. 30 until the organisation saves another value.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistrySettingsResponse200 | GetApiGovernanceRegistrySettingsResponse400 | GetApiGovernanceRegistrySettingsResponse401 | GetApiGovernanceRegistrySettingsResponse403 | GetApiGovernanceRegistrySettingsResponse500]
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
    GetApiGovernanceRegistrySettingsResponse200
    | GetApiGovernanceRegistrySettingsResponse400
    | GetApiGovernanceRegistrySettingsResponse401
    | GetApiGovernanceRegistrySettingsResponse403
    | GetApiGovernanceRegistrySettingsResponse500
    | None
):
    """Get the registry settings

     The organisation's dormancy window: the days without a trace after which a listed agent reads as
    `dormant`. 30 until the organisation saves another value.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistrySettingsResponse200 | GetApiGovernanceRegistrySettingsResponse400 | GetApiGovernanceRegistrySettingsResponse401 | GetApiGovernanceRegistrySettingsResponse403 | GetApiGovernanceRegistrySettingsResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceRegistrySettingsResponse200
    | GetApiGovernanceRegistrySettingsResponse400
    | GetApiGovernanceRegistrySettingsResponse401
    | GetApiGovernanceRegistrySettingsResponse403
    | GetApiGovernanceRegistrySettingsResponse500
]:
    """Get the registry settings

     The organisation's dormancy window: the days without a trace after which a listed agent reads as
    `dormant`. 30 until the organisation saves another value.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceRegistrySettingsResponse200 | GetApiGovernanceRegistrySettingsResponse400 | GetApiGovernanceRegistrySettingsResponse401 | GetApiGovernanceRegistrySettingsResponse403 | GetApiGovernanceRegistrySettingsResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceRegistrySettingsResponse200
    | GetApiGovernanceRegistrySettingsResponse400
    | GetApiGovernanceRegistrySettingsResponse401
    | GetApiGovernanceRegistrySettingsResponse403
    | GetApiGovernanceRegistrySettingsResponse500
    | None
):
    """Get the registry settings

     The organisation's dormancy window: the days without a trace after which a listed agent reads as
    `dormant`. 30 until the organisation saves another value.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceRegistrySettingsResponse200 | GetApiGovernanceRegistrySettingsResponse400 | GetApiGovernanceRegistrySettingsResponse401 | GetApiGovernanceRegistrySettingsResponse403 | GetApiGovernanceRegistrySettingsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
