from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_ingestion_templates_response_201 import (
    PostApiGovernanceIngestionTemplatesResponse201,
)
from ...models.post_api_governance_ingestion_templates_response_400 import (
    PostApiGovernanceIngestionTemplatesResponse400,
)
from ...models.post_api_governance_ingestion_templates_response_401 import (
    PostApiGovernanceIngestionTemplatesResponse401,
)
from ...models.post_api_governance_ingestion_templates_response_422 import (
    PostApiGovernanceIngestionTemplatesResponse422,
)
from ...models.post_api_governance_ingestion_templates_response_500 import (
    PostApiGovernanceIngestionTemplatesResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/governance/ingestion-templates",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceIngestionTemplatesResponse201
    | PostApiGovernanceIngestionTemplatesResponse400
    | PostApiGovernanceIngestionTemplatesResponse401
    | PostApiGovernanceIngestionTemplatesResponse422
    | PostApiGovernanceIngestionTemplatesResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiGovernanceIngestionTemplatesResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiGovernanceIngestionTemplatesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceIngestionTemplatesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiGovernanceIngestionTemplatesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceIngestionTemplatesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceIngestionTemplatesResponse201
    | PostApiGovernanceIngestionTemplatesResponse400
    | PostApiGovernanceIngestionTemplatesResponse401
    | PostApiGovernanceIngestionTemplatesResponse422
    | PostApiGovernanceIngestionTemplatesResponse500
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
    client: AuthenticatedClient | Client,
) -> Response[
    PostApiGovernanceIngestionTemplatesResponse201
    | PostApiGovernanceIngestionTemplatesResponse400
    | PostApiGovernanceIngestionTemplatesResponse401
    | PostApiGovernanceIngestionTemplatesResponse422
    | PostApiGovernanceIngestionTemplatesResponse500
]:
    """Create org-authored ingestion template

     Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform
    rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform
    defaults via POST /ingestion-templates/clone instead.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceIngestionTemplatesResponse201 | PostApiGovernanceIngestionTemplatesResponse400 | PostApiGovernanceIngestionTemplatesResponse401 | PostApiGovernanceIngestionTemplatesResponse422 | PostApiGovernanceIngestionTemplatesResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> (
    PostApiGovernanceIngestionTemplatesResponse201
    | PostApiGovernanceIngestionTemplatesResponse400
    | PostApiGovernanceIngestionTemplatesResponse401
    | PostApiGovernanceIngestionTemplatesResponse422
    | PostApiGovernanceIngestionTemplatesResponse500
    | None
):
    """Create org-authored ingestion template

     Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform
    rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform
    defaults via POST /ingestion-templates/clone instead.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceIngestionTemplatesResponse201 | PostApiGovernanceIngestionTemplatesResponse400 | PostApiGovernanceIngestionTemplatesResponse401 | PostApiGovernanceIngestionTemplatesResponse422 | PostApiGovernanceIngestionTemplatesResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    PostApiGovernanceIngestionTemplatesResponse201
    | PostApiGovernanceIngestionTemplatesResponse400
    | PostApiGovernanceIngestionTemplatesResponse401
    | PostApiGovernanceIngestionTemplatesResponse422
    | PostApiGovernanceIngestionTemplatesResponse500
]:
    """Create org-authored ingestion template

     Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform
    rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform
    defaults via POST /ingestion-templates/clone instead.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceIngestionTemplatesResponse201 | PostApiGovernanceIngestionTemplatesResponse400 | PostApiGovernanceIngestionTemplatesResponse401 | PostApiGovernanceIngestionTemplatesResponse422 | PostApiGovernanceIngestionTemplatesResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    PostApiGovernanceIngestionTemplatesResponse201
    | PostApiGovernanceIngestionTemplatesResponse400
    | PostApiGovernanceIngestionTemplatesResponse401
    | PostApiGovernanceIngestionTemplatesResponse422
    | PostApiGovernanceIngestionTemplatesResponse500
    | None
):
    """Create org-authored ingestion template

     Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform
    rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform
    defaults via POST /ingestion-templates/clone instead.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceIngestionTemplatesResponse201 | PostApiGovernanceIngestionTemplatesResponse400 | PostApiGovernanceIngestionTemplatesResponse401 | PostApiGovernanceIngestionTemplatesResponse422 | PostApiGovernanceIngestionTemplatesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
