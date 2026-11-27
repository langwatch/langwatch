from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_governance_registry_settings_body import PutApiGovernanceRegistrySettingsBody
from ...models.put_api_governance_registry_settings_response_200 import PutApiGovernanceRegistrySettingsResponse200
from ...models.put_api_governance_registry_settings_response_400 import PutApiGovernanceRegistrySettingsResponse400
from ...models.put_api_governance_registry_settings_response_401 import PutApiGovernanceRegistrySettingsResponse401
from ...models.put_api_governance_registry_settings_response_403 import PutApiGovernanceRegistrySettingsResponse403
from ...models.put_api_governance_registry_settings_response_422 import PutApiGovernanceRegistrySettingsResponse422
from ...models.put_api_governance_registry_settings_response_500 import PutApiGovernanceRegistrySettingsResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PutApiGovernanceRegistrySettingsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/governance/registry/settings",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PutApiGovernanceRegistrySettingsResponse200
    | PutApiGovernanceRegistrySettingsResponse400
    | PutApiGovernanceRegistrySettingsResponse401
    | PutApiGovernanceRegistrySettingsResponse403
    | PutApiGovernanceRegistrySettingsResponse422
    | PutApiGovernanceRegistrySettingsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiGovernanceRegistrySettingsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiGovernanceRegistrySettingsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiGovernanceRegistrySettingsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PutApiGovernanceRegistrySettingsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = PutApiGovernanceRegistrySettingsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiGovernanceRegistrySettingsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiGovernanceRegistrySettingsResponse200
    | PutApiGovernanceRegistrySettingsResponse400
    | PutApiGovernanceRegistrySettingsResponse401
    | PutApiGovernanceRegistrySettingsResponse403
    | PutApiGovernanceRegistrySettingsResponse422
    | PutApiGovernanceRegistrySettingsResponse500
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
    body: PutApiGovernanceRegistrySettingsBody,
) -> Response[
    PutApiGovernanceRegistrySettingsResponse200
    | PutApiGovernanceRegistrySettingsResponse400
    | PutApiGovernanceRegistrySettingsResponse401
    | PutApiGovernanceRegistrySettingsResponse403
    | PutApiGovernanceRegistrySettingsResponse422
    | PutApiGovernanceRegistrySettingsResponse500
]:
    """Save the registry settings

     Sets the organisation's dormancy window, 1 to 365 days. The next reconcile applies it to every
    listed agent. Needs `ingestionSources:manage`.

    Args:
        body (PutApiGovernanceRegistrySettingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiGovernanceRegistrySettingsResponse200 | PutApiGovernanceRegistrySettingsResponse400 | PutApiGovernanceRegistrySettingsResponse401 | PutApiGovernanceRegistrySettingsResponse403 | PutApiGovernanceRegistrySettingsResponse422 | PutApiGovernanceRegistrySettingsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PutApiGovernanceRegistrySettingsBody,
) -> (
    PutApiGovernanceRegistrySettingsResponse200
    | PutApiGovernanceRegistrySettingsResponse400
    | PutApiGovernanceRegistrySettingsResponse401
    | PutApiGovernanceRegistrySettingsResponse403
    | PutApiGovernanceRegistrySettingsResponse422
    | PutApiGovernanceRegistrySettingsResponse500
    | None
):
    """Save the registry settings

     Sets the organisation's dormancy window, 1 to 365 days. The next reconcile applies it to every
    listed agent. Needs `ingestionSources:manage`.

    Args:
        body (PutApiGovernanceRegistrySettingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiGovernanceRegistrySettingsResponse200 | PutApiGovernanceRegistrySettingsResponse400 | PutApiGovernanceRegistrySettingsResponse401 | PutApiGovernanceRegistrySettingsResponse403 | PutApiGovernanceRegistrySettingsResponse422 | PutApiGovernanceRegistrySettingsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PutApiGovernanceRegistrySettingsBody,
) -> Response[
    PutApiGovernanceRegistrySettingsResponse200
    | PutApiGovernanceRegistrySettingsResponse400
    | PutApiGovernanceRegistrySettingsResponse401
    | PutApiGovernanceRegistrySettingsResponse403
    | PutApiGovernanceRegistrySettingsResponse422
    | PutApiGovernanceRegistrySettingsResponse500
]:
    """Save the registry settings

     Sets the organisation's dormancy window, 1 to 365 days. The next reconcile applies it to every
    listed agent. Needs `ingestionSources:manage`.

    Args:
        body (PutApiGovernanceRegistrySettingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiGovernanceRegistrySettingsResponse200 | PutApiGovernanceRegistrySettingsResponse400 | PutApiGovernanceRegistrySettingsResponse401 | PutApiGovernanceRegistrySettingsResponse403 | PutApiGovernanceRegistrySettingsResponse422 | PutApiGovernanceRegistrySettingsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PutApiGovernanceRegistrySettingsBody,
) -> (
    PutApiGovernanceRegistrySettingsResponse200
    | PutApiGovernanceRegistrySettingsResponse400
    | PutApiGovernanceRegistrySettingsResponse401
    | PutApiGovernanceRegistrySettingsResponse403
    | PutApiGovernanceRegistrySettingsResponse422
    | PutApiGovernanceRegistrySettingsResponse500
    | None
):
    """Save the registry settings

     Sets the organisation's dormancy window, 1 to 365 days. The next reconcile applies it to every
    listed agent. Needs `ingestionSources:manage`.

    Args:
        body (PutApiGovernanceRegistrySettingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiGovernanceRegistrySettingsResponse200 | PutApiGovernanceRegistrySettingsResponse400 | PutApiGovernanceRegistrySettingsResponse401 | PutApiGovernanceRegistrySettingsResponse403 | PutApiGovernanceRegistrySettingsResponse422 | PutApiGovernanceRegistrySettingsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
