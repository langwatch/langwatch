from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_agents_by_id_body import PutApiAgentsByIdBody
from ...models.put_api_agents_by_id_response_200 import PutApiAgentsByIdResponse200
from ...models.put_api_agents_by_id_response_404 import PutApiAgentsByIdResponse404
from ...models.put_api_agents_by_id_response_422 import PutApiAgentsByIdResponse422
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PutApiAgentsByIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/agents/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422 | None:
    if response.status_code == 200:
        response_200 = PutApiAgentsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PutApiAgentsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PutApiAgentsByIdResponse422.from_dict(response.json())

        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422]:
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
    body: PutApiAgentsByIdBody,
) -> Response[PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422]:
    """Update an agent by its id

    Args:
        id (str):
        body (PutApiAgentsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiAgentsByIdBody,
) -> PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422 | None:
    """Update an agent by its id

    Args:
        id (str):
        body (PutApiAgentsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiAgentsByIdBody,
) -> Response[PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422]:
    """Update an agent by its id

    Args:
        id (str):
        body (PutApiAgentsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiAgentsByIdBody,
) -> PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422 | None:
    """Update an agent by its id

    Args:
        id (str):
        body (PutApiAgentsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiAgentsByIdResponse200 | PutApiAgentsByIdResponse404 | PutApiAgentsByIdResponse422
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
