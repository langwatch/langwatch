from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_governance_security_lake_sources_by_id_response_200 import (
    GetApiGovernanceSecurityLakeSourcesByIdResponse200,
)
from ...models.get_api_governance_security_lake_sources_by_id_response_400 import (
    GetApiGovernanceSecurityLakeSourcesByIdResponse400,
)
from ...models.get_api_governance_security_lake_sources_by_id_response_401 import (
    GetApiGovernanceSecurityLakeSourcesByIdResponse401,
)
from ...models.get_api_governance_security_lake_sources_by_id_response_403 import (
    GetApiGovernanceSecurityLakeSourcesByIdResponse403,
)
from ...models.get_api_governance_security_lake_sources_by_id_response_500 import (
    GetApiGovernanceSecurityLakeSourcesByIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    source_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/governance/security-lake/sources/{source_id}".format(
            source_id=quote(str(source_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGovernanceSecurityLakeSourcesByIdResponse200
    | GetApiGovernanceSecurityLakeSourcesByIdResponse400
    | GetApiGovernanceSecurityLakeSourcesByIdResponse401
    | GetApiGovernanceSecurityLakeSourcesByIdResponse403
    | GetApiGovernanceSecurityLakeSourcesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGovernanceSecurityLakeSourcesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGovernanceSecurityLakeSourcesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGovernanceSecurityLakeSourcesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGovernanceSecurityLakeSourcesByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGovernanceSecurityLakeSourcesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGovernanceSecurityLakeSourcesByIdResponse200
    | GetApiGovernanceSecurityLakeSourcesByIdResponse400
    | GetApiGovernanceSecurityLakeSourcesByIdResponse401
    | GetApiGovernanceSecurityLakeSourcesByIdResponse403
    | GetApiGovernanceSecurityLakeSourcesByIdResponse500
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
) -> Response[
    GetApiGovernanceSecurityLakeSourcesByIdResponse200
    | GetApiGovernanceSecurityLakeSourcesByIdResponse400
    | GetApiGovernanceSecurityLakeSourcesByIdResponse401
    | GetApiGovernanceSecurityLakeSourcesByIdResponse403
    | GetApiGovernanceSecurityLakeSourcesByIdResponse500
]:
    """Read a Security Lake source

     The source's settings and the external id LangWatch generated for it. The subscriber role's trust
    policy must require this external id as the `sts:ExternalId` condition.

    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceSecurityLakeSourcesByIdResponse200 | GetApiGovernanceSecurityLakeSourcesByIdResponse400 | GetApiGovernanceSecurityLakeSourcesByIdResponse401 | GetApiGovernanceSecurityLakeSourcesByIdResponse403 | GetApiGovernanceSecurityLakeSourcesByIdResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceSecurityLakeSourcesByIdResponse200
    | GetApiGovernanceSecurityLakeSourcesByIdResponse400
    | GetApiGovernanceSecurityLakeSourcesByIdResponse401
    | GetApiGovernanceSecurityLakeSourcesByIdResponse403
    | GetApiGovernanceSecurityLakeSourcesByIdResponse500
    | None
):
    """Read a Security Lake source

     The source's settings and the external id LangWatch generated for it. The subscriber role's trust
    policy must require this external id as the `sts:ExternalId` condition.

    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceSecurityLakeSourcesByIdResponse200 | GetApiGovernanceSecurityLakeSourcesByIdResponse400 | GetApiGovernanceSecurityLakeSourcesByIdResponse401 | GetApiGovernanceSecurityLakeSourcesByIdResponse403 | GetApiGovernanceSecurityLakeSourcesByIdResponse500
    """

    return sync_detailed(
        source_id=source_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiGovernanceSecurityLakeSourcesByIdResponse200
    | GetApiGovernanceSecurityLakeSourcesByIdResponse400
    | GetApiGovernanceSecurityLakeSourcesByIdResponse401
    | GetApiGovernanceSecurityLakeSourcesByIdResponse403
    | GetApiGovernanceSecurityLakeSourcesByIdResponse500
]:
    """Read a Security Lake source

     The source's settings and the external id LangWatch generated for it. The subscriber role's trust
    policy must require this external id as the `sts:ExternalId` condition.

    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGovernanceSecurityLakeSourcesByIdResponse200 | GetApiGovernanceSecurityLakeSourcesByIdResponse400 | GetApiGovernanceSecurityLakeSourcesByIdResponse401 | GetApiGovernanceSecurityLakeSourcesByIdResponse403 | GetApiGovernanceSecurityLakeSourcesByIdResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    source_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiGovernanceSecurityLakeSourcesByIdResponse200
    | GetApiGovernanceSecurityLakeSourcesByIdResponse400
    | GetApiGovernanceSecurityLakeSourcesByIdResponse401
    | GetApiGovernanceSecurityLakeSourcesByIdResponse403
    | GetApiGovernanceSecurityLakeSourcesByIdResponse500
    | None
):
    """Read a Security Lake source

     The source's settings and the external id LangWatch generated for it. The subscriber role's trust
    policy must require this external id as the `sts:ExternalId` condition.

    Args:
        source_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGovernanceSecurityLakeSourcesByIdResponse200 | GetApiGovernanceSecurityLakeSourcesByIdResponse400 | GetApiGovernanceSecurityLakeSourcesByIdResponse401 | GetApiGovernanceSecurityLakeSourcesByIdResponse403 | GetApiGovernanceSecurityLakeSourcesByIdResponse500
    """

    return (
        await asyncio_detailed(
            source_id=source_id,
            client=client,
        )
    ).parsed
