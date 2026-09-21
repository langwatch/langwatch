from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_governance_ingestion_templates_by_id_response_200 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse200,
)
from ...models.delete_api_governance_ingestion_templates_by_id_response_400 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse400,
)
from ...models.delete_api_governance_ingestion_templates_by_id_response_401 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse401,
)
from ...models.delete_api_governance_ingestion_templates_by_id_response_403 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse403,
)
from ...models.delete_api_governance_ingestion_templates_by_id_response_404 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse404,
)
from ...models.delete_api_governance_ingestion_templates_by_id_response_422 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse422,
)
from ...models.delete_api_governance_ingestion_templates_by_id_response_500 import (
    DeleteApiGovernanceIngestionTemplatesByIdResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/governance/ingestion-templates/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiGovernanceIngestionTemplatesByIdResponse200
    | DeleteApiGovernanceIngestionTemplatesByIdResponse400
    | DeleteApiGovernanceIngestionTemplatesByIdResponse401
    | DeleteApiGovernanceIngestionTemplatesByIdResponse403
    | DeleteApiGovernanceIngestionTemplatesByIdResponse404
    | DeleteApiGovernanceIngestionTemplatesByIdResponse422
    | DeleteApiGovernanceIngestionTemplatesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteApiGovernanceIngestionTemplatesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiGovernanceIngestionTemplatesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiGovernanceIngestionTemplatesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = DeleteApiGovernanceIngestionTemplatesByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = DeleteApiGovernanceIngestionTemplatesByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = DeleteApiGovernanceIngestionTemplatesByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = DeleteApiGovernanceIngestionTemplatesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiGovernanceIngestionTemplatesByIdResponse200
    | DeleteApiGovernanceIngestionTemplatesByIdResponse400
    | DeleteApiGovernanceIngestionTemplatesByIdResponse401
    | DeleteApiGovernanceIngestionTemplatesByIdResponse403
    | DeleteApiGovernanceIngestionTemplatesByIdResponse404
    | DeleteApiGovernanceIngestionTemplatesByIdResponse422
    | DeleteApiGovernanceIngestionTemplatesByIdResponse500
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
    client: AuthenticatedClient,
) -> Response[
    DeleteApiGovernanceIngestionTemplatesByIdResponse200
    | DeleteApiGovernanceIngestionTemplatesByIdResponse400
    | DeleteApiGovernanceIngestionTemplatesByIdResponse401
    | DeleteApiGovernanceIngestionTemplatesByIdResponse403
    | DeleteApiGovernanceIngestionTemplatesByIdResponse404
    | DeleteApiGovernanceIngestionTemplatesByIdResponse422
    | DeleteApiGovernanceIngestionTemplatesByIdResponse500
]:
    """Soft-archive an org-authored template

     Marks the row archived; existing ingestion keys continue to land traces but the row disappears from
    list views. Platform-published rows reject with 403.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGovernanceIngestionTemplatesByIdResponse200 | DeleteApiGovernanceIngestionTemplatesByIdResponse400 | DeleteApiGovernanceIngestionTemplatesByIdResponse401 | DeleteApiGovernanceIngestionTemplatesByIdResponse403 | DeleteApiGovernanceIngestionTemplatesByIdResponse404 | DeleteApiGovernanceIngestionTemplatesByIdResponse422 | DeleteApiGovernanceIngestionTemplatesByIdResponse500]
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
    client: AuthenticatedClient,
) -> (
    DeleteApiGovernanceIngestionTemplatesByIdResponse200
    | DeleteApiGovernanceIngestionTemplatesByIdResponse400
    | DeleteApiGovernanceIngestionTemplatesByIdResponse401
    | DeleteApiGovernanceIngestionTemplatesByIdResponse403
    | DeleteApiGovernanceIngestionTemplatesByIdResponse404
    | DeleteApiGovernanceIngestionTemplatesByIdResponse422
    | DeleteApiGovernanceIngestionTemplatesByIdResponse500
    | None
):
    """Soft-archive an org-authored template

     Marks the row archived; existing ingestion keys continue to land traces but the row disappears from
    list views. Platform-published rows reject with 403.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGovernanceIngestionTemplatesByIdResponse200 | DeleteApiGovernanceIngestionTemplatesByIdResponse400 | DeleteApiGovernanceIngestionTemplatesByIdResponse401 | DeleteApiGovernanceIngestionTemplatesByIdResponse403 | DeleteApiGovernanceIngestionTemplatesByIdResponse404 | DeleteApiGovernanceIngestionTemplatesByIdResponse422 | DeleteApiGovernanceIngestionTemplatesByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteApiGovernanceIngestionTemplatesByIdResponse200
    | DeleteApiGovernanceIngestionTemplatesByIdResponse400
    | DeleteApiGovernanceIngestionTemplatesByIdResponse401
    | DeleteApiGovernanceIngestionTemplatesByIdResponse403
    | DeleteApiGovernanceIngestionTemplatesByIdResponse404
    | DeleteApiGovernanceIngestionTemplatesByIdResponse422
    | DeleteApiGovernanceIngestionTemplatesByIdResponse500
]:
    """Soft-archive an org-authored template

     Marks the row archived; existing ingestion keys continue to land traces but the row disappears from
    list views. Platform-published rows reject with 403.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGovernanceIngestionTemplatesByIdResponse200 | DeleteApiGovernanceIngestionTemplatesByIdResponse400 | DeleteApiGovernanceIngestionTemplatesByIdResponse401 | DeleteApiGovernanceIngestionTemplatesByIdResponse403 | DeleteApiGovernanceIngestionTemplatesByIdResponse404 | DeleteApiGovernanceIngestionTemplatesByIdResponse422 | DeleteApiGovernanceIngestionTemplatesByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteApiGovernanceIngestionTemplatesByIdResponse200
    | DeleteApiGovernanceIngestionTemplatesByIdResponse400
    | DeleteApiGovernanceIngestionTemplatesByIdResponse401
    | DeleteApiGovernanceIngestionTemplatesByIdResponse403
    | DeleteApiGovernanceIngestionTemplatesByIdResponse404
    | DeleteApiGovernanceIngestionTemplatesByIdResponse422
    | DeleteApiGovernanceIngestionTemplatesByIdResponse500
    | None
):
    """Soft-archive an org-authored template

     Marks the row archived; existing ingestion keys continue to land traces but the row disappears from
    list views. Platform-published rows reject with 403.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGovernanceIngestionTemplatesByIdResponse200 | DeleteApiGovernanceIngestionTemplatesByIdResponse400 | DeleteApiGovernanceIngestionTemplatesByIdResponse401 | DeleteApiGovernanceIngestionTemplatesByIdResponse403 | DeleteApiGovernanceIngestionTemplatesByIdResponse404 | DeleteApiGovernanceIngestionTemplatesByIdResponse422 | DeleteApiGovernanceIngestionTemplatesByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
