from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_ingestion_templates_clone_response_201 import (
    PostApiGovernanceIngestionTemplatesCloneResponse201,
)
from ...models.post_api_governance_ingestion_templates_clone_response_400 import (
    PostApiGovernanceIngestionTemplatesCloneResponse400,
)
from ...models.post_api_governance_ingestion_templates_clone_response_401 import (
    PostApiGovernanceIngestionTemplatesCloneResponse401,
)
from ...models.post_api_governance_ingestion_templates_clone_response_404 import (
    PostApiGovernanceIngestionTemplatesCloneResponse404,
)
from ...models.post_api_governance_ingestion_templates_clone_response_422 import (
    PostApiGovernanceIngestionTemplatesCloneResponse422,
)
from ...models.post_api_governance_ingestion_templates_clone_response_500 import (
    PostApiGovernanceIngestionTemplatesCloneResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/governance/ingestion-templates/clone",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceIngestionTemplatesCloneResponse201
    | PostApiGovernanceIngestionTemplatesCloneResponse400
    | PostApiGovernanceIngestionTemplatesCloneResponse401
    | PostApiGovernanceIngestionTemplatesCloneResponse404
    | PostApiGovernanceIngestionTemplatesCloneResponse422
    | PostApiGovernanceIngestionTemplatesCloneResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiGovernanceIngestionTemplatesCloneResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiGovernanceIngestionTemplatesCloneResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceIngestionTemplatesCloneResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiGovernanceIngestionTemplatesCloneResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PostApiGovernanceIngestionTemplatesCloneResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceIngestionTemplatesCloneResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceIngestionTemplatesCloneResponse201
    | PostApiGovernanceIngestionTemplatesCloneResponse400
    | PostApiGovernanceIngestionTemplatesCloneResponse401
    | PostApiGovernanceIngestionTemplatesCloneResponse404
    | PostApiGovernanceIngestionTemplatesCloneResponse422
    | PostApiGovernanceIngestionTemplatesCloneResponse500
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
    PostApiGovernanceIngestionTemplatesCloneResponse201
    | PostApiGovernanceIngestionTemplatesCloneResponse400
    | PostApiGovernanceIngestionTemplatesCloneResponse401
    | PostApiGovernanceIngestionTemplatesCloneResponse404
    | PostApiGovernanceIngestionTemplatesCloneResponse422
    | PostApiGovernanceIngestionTemplatesCloneResponse500
]:
    """Clone a platform-published template into the caller's org

     Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the
    admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceIngestionTemplatesCloneResponse201 | PostApiGovernanceIngestionTemplatesCloneResponse400 | PostApiGovernanceIngestionTemplatesCloneResponse401 | PostApiGovernanceIngestionTemplatesCloneResponse404 | PostApiGovernanceIngestionTemplatesCloneResponse422 | PostApiGovernanceIngestionTemplatesCloneResponse500]
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
    PostApiGovernanceIngestionTemplatesCloneResponse201
    | PostApiGovernanceIngestionTemplatesCloneResponse400
    | PostApiGovernanceIngestionTemplatesCloneResponse401
    | PostApiGovernanceIngestionTemplatesCloneResponse404
    | PostApiGovernanceIngestionTemplatesCloneResponse422
    | PostApiGovernanceIngestionTemplatesCloneResponse500
    | None
):
    """Clone a platform-published template into the caller's org

     Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the
    admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceIngestionTemplatesCloneResponse201 | PostApiGovernanceIngestionTemplatesCloneResponse400 | PostApiGovernanceIngestionTemplatesCloneResponse401 | PostApiGovernanceIngestionTemplatesCloneResponse404 | PostApiGovernanceIngestionTemplatesCloneResponse422 | PostApiGovernanceIngestionTemplatesCloneResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    PostApiGovernanceIngestionTemplatesCloneResponse201
    | PostApiGovernanceIngestionTemplatesCloneResponse400
    | PostApiGovernanceIngestionTemplatesCloneResponse401
    | PostApiGovernanceIngestionTemplatesCloneResponse404
    | PostApiGovernanceIngestionTemplatesCloneResponse422
    | PostApiGovernanceIngestionTemplatesCloneResponse500
]:
    """Clone a platform-published template into the caller's org

     Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the
    admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceIngestionTemplatesCloneResponse201 | PostApiGovernanceIngestionTemplatesCloneResponse400 | PostApiGovernanceIngestionTemplatesCloneResponse401 | PostApiGovernanceIngestionTemplatesCloneResponse404 | PostApiGovernanceIngestionTemplatesCloneResponse422 | PostApiGovernanceIngestionTemplatesCloneResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    PostApiGovernanceIngestionTemplatesCloneResponse201
    | PostApiGovernanceIngestionTemplatesCloneResponse400
    | PostApiGovernanceIngestionTemplatesCloneResponse401
    | PostApiGovernanceIngestionTemplatesCloneResponse404
    | PostApiGovernanceIngestionTemplatesCloneResponse422
    | PostApiGovernanceIngestionTemplatesCloneResponse500
    | None
):
    """Clone a platform-published template into the caller's org

     Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the
    admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceIngestionTemplatesCloneResponse201 | PostApiGovernanceIngestionTemplatesCloneResponse400 | PostApiGovernanceIngestionTemplatesCloneResponse401 | PostApiGovernanceIngestionTemplatesCloneResponse404 | PostApiGovernanceIngestionTemplatesCloneResponse422 | PostApiGovernanceIngestionTemplatesCloneResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
