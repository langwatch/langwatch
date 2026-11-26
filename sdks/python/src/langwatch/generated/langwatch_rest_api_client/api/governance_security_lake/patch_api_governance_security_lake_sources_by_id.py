from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_governance_security_lake_sources_by_id_body import (
    PatchApiGovernanceSecurityLakeSourcesByIdBody,
)
from ...models.patch_api_governance_security_lake_sources_by_id_response_200 import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200,
)
from ...models.patch_api_governance_security_lake_sources_by_id_response_400 import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse400,
)
from ...models.patch_api_governance_security_lake_sources_by_id_response_401 import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse401,
)
from ...models.patch_api_governance_security_lake_sources_by_id_response_403 import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse403,
)
from ...models.patch_api_governance_security_lake_sources_by_id_response_422 import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse422,
)
from ...models.patch_api_governance_security_lake_sources_by_id_response_500 import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    source_id: str,
    *,
    body: PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/governance/security-lake/sources/{source_id}".format(
            source_id=quote(str(source_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse400
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse401
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse403
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse422
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiGovernanceSecurityLakeSourcesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiGovernanceSecurityLakeSourcesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiGovernanceSecurityLakeSourcesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiGovernanceSecurityLakeSourcesByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = PatchApiGovernanceSecurityLakeSourcesByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiGovernanceSecurityLakeSourcesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse400
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse401
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse403
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse422
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
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
    body: PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset = UNSET,
) -> Response[
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse400
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse401
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse403
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse422
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
]:
    """Edit an AWS Security Lake source

     Changes the name, queue settings, sources, schedule, access keys or status of a Security Lake
    source. Fields left out keep their stored value. The external id stays as LangWatch generated it.

    Args:
        source_id (str):
        body (PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGovernanceSecurityLakeSourcesByIdResponse200 | PatchApiGovernanceSecurityLakeSourcesByIdResponse400 | PatchApiGovernanceSecurityLakeSourcesByIdResponse401 | PatchApiGovernanceSecurityLakeSourcesByIdResponse403 | PatchApiGovernanceSecurityLakeSourcesByIdResponse422 | PatchApiGovernanceSecurityLakeSourcesByIdResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset = UNSET,
) -> (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse400
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse401
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse403
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse422
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
    | None
):
    """Edit an AWS Security Lake source

     Changes the name, queue settings, sources, schedule, access keys or status of a Security Lake
    source. Fields left out keep their stored value. The external id stays as LangWatch generated it.

    Args:
        source_id (str):
        body (PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGovernanceSecurityLakeSourcesByIdResponse200 | PatchApiGovernanceSecurityLakeSourcesByIdResponse400 | PatchApiGovernanceSecurityLakeSourcesByIdResponse401 | PatchApiGovernanceSecurityLakeSourcesByIdResponse403 | PatchApiGovernanceSecurityLakeSourcesByIdResponse422 | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
    """

    return sync_detailed(
        source_id=source_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset = UNSET,
) -> Response[
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse400
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse401
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse403
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse422
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
]:
    """Edit an AWS Security Lake source

     Changes the name, queue settings, sources, schedule, access keys or status of a Security Lake
    source. Fields left out keep their stored value. The external id stays as LangWatch generated it.

    Args:
        source_id (str):
        body (PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGovernanceSecurityLakeSourcesByIdResponse200 | PatchApiGovernanceSecurityLakeSourcesByIdResponse400 | PatchApiGovernanceSecurityLakeSourcesByIdResponse401 | PatchApiGovernanceSecurityLakeSourcesByIdResponse403 | PatchApiGovernanceSecurityLakeSourcesByIdResponse422 | PatchApiGovernanceSecurityLakeSourcesByIdResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset = UNSET,
) -> (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse400
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse401
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse403
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse422
    | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
    | None
):
    """Edit an AWS Security Lake source

     Changes the name, queue settings, sources, schedule, access keys or status of a Security Lake
    source. Fields left out keep their stored value. The external id stays as LangWatch generated it.

    Args:
        source_id (str):
        body (PatchApiGovernanceSecurityLakeSourcesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGovernanceSecurityLakeSourcesByIdResponse200 | PatchApiGovernanceSecurityLakeSourcesByIdResponse400 | PatchApiGovernanceSecurityLakeSourcesByIdResponse401 | PatchApiGovernanceSecurityLakeSourcesByIdResponse403 | PatchApiGovernanceSecurityLakeSourcesByIdResponse422 | PatchApiGovernanceSecurityLakeSourcesByIdResponse500
    """

    return (
        await asyncio_detailed(
            source_id=source_id,
            client=client,
            body=body,
        )
    ).parsed
