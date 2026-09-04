from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.replace_agent_body import ReplaceAgentBody
from ...models.replace_agent_response_200 import ReplaceAgentResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: ReplaceAgentBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/agents/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ReplaceAgentResponse200 | None:
    if response.status_code == 200:
        response_200 = ReplaceAgentResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ReplaceAgentResponse200]:
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
    body: ReplaceAgentBody,
) -> Response[ReplaceAgentResponse200]:
    """Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH
    and PUT alike. A connected agent takes only a new description; anything else answers 422
    agent_register_only.

    Args:
        id (str):
        body (ReplaceAgentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReplaceAgentResponse200]
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
    body: ReplaceAgentBody,
) -> ReplaceAgentResponse200 | None:
    """Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH
    and PUT alike. A connected agent takes only a new description; anything else answers 422
    agent_register_only.

    Args:
        id (str):
        body (ReplaceAgentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReplaceAgentResponse200
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
    body: ReplaceAgentBody,
) -> Response[ReplaceAgentResponse200]:
    """Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH
    and PUT alike. A connected agent takes only a new description; anything else answers 422
    agent_register_only.

    Args:
        id (str):
        body (ReplaceAgentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ReplaceAgentResponse200]
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
    body: ReplaceAgentBody,
) -> ReplaceAgentResponse200 | None:
    """Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH
    and PUT alike. A connected agent takes only a new description; anything else answers 422
    agent_register_only.

    Args:
        id (str):
        body (ReplaceAgentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ReplaceAgentResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
