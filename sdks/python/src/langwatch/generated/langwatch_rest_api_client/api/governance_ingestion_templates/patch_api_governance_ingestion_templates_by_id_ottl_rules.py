from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200,
)
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_400 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400,
)
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_401 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401,
)
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_403 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403,
)
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_404 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404,
)
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_422 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422,
)
from ...models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_500 import (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/governance/ingestion-templates/{id}/ottl-rules".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
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
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
]:
    """Replace ottl_rules on an org-authored template

     Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a
    platform row before editing it.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500]
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
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
    | None
):
    """Replace ottl_rules on an org-authored template

     Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a
    platform row before editing it.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
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
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
]:
    """Replace ottl_rules on an org-authored template

     Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a
    platform row before editing it.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500]
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
    PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422
    | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
    | None
):
    """Replace ottl_rules on an org-authored template

     Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a
    platform row before editing it.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse400 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse401 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse403 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse404 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse422 | PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
