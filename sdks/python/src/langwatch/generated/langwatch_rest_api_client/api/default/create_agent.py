from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_agent_body_type_0 import CreateAgentBodyType0
from ...models.create_agent_body_type_1 import CreateAgentBodyType1
from ...models.create_agent_body_type_2 import CreateAgentBodyType2
from ...models.create_agent_body_type_3 import CreateAgentBodyType3
from ...models.create_agent_body_type_4 import CreateAgentBodyType4
from ...models.create_agent_response_201 import CreateAgentResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: CreateAgentBodyType0
    | CreateAgentBodyType1
    | CreateAgentBodyType2
    | CreateAgentBodyType3
    | CreateAgentBodyType4,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/agents",
    }

    if isinstance(body, CreateAgentBodyType0):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CreateAgentBodyType1):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CreateAgentBodyType2):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, CreateAgentBodyType3):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> CreateAgentResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateAgentResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CreateAgentResponse201]:
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
    body: CreateAgentBodyType0
    | CreateAgentBodyType1
    | CreateAgentBodyType2
    | CreateAgentBodyType3
    | CreateAgentBodyType4,
) -> Response[CreateAgentResponse201]:
    """Create an authored agent; connected agents register through the SDK

    Args:
        body (CreateAgentBodyType0 | CreateAgentBodyType1 | CreateAgentBodyType2 |
            CreateAgentBodyType3 | CreateAgentBodyType4):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateAgentResponse201]
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
    body: CreateAgentBodyType0
    | CreateAgentBodyType1
    | CreateAgentBodyType2
    | CreateAgentBodyType3
    | CreateAgentBodyType4,
) -> CreateAgentResponse201 | None:
    """Create an authored agent; connected agents register through the SDK

    Args:
        body (CreateAgentBodyType0 | CreateAgentBodyType1 | CreateAgentBodyType2 |
            CreateAgentBodyType3 | CreateAgentBodyType4):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateAgentResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateAgentBodyType0
    | CreateAgentBodyType1
    | CreateAgentBodyType2
    | CreateAgentBodyType3
    | CreateAgentBodyType4,
) -> Response[CreateAgentResponse201]:
    """Create an authored agent; connected agents register through the SDK

    Args:
        body (CreateAgentBodyType0 | CreateAgentBodyType1 | CreateAgentBodyType2 |
            CreateAgentBodyType3 | CreateAgentBodyType4):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateAgentResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateAgentBodyType0
    | CreateAgentBodyType1
    | CreateAgentBodyType2
    | CreateAgentBodyType3
    | CreateAgentBodyType4,
) -> CreateAgentResponse201 | None:
    """Create an authored agent; connected agents register through the SDK

    Args:
        body (CreateAgentBodyType0 | CreateAgentBodyType1 | CreateAgentBodyType2 |
            CreateAgentBodyType3 | CreateAgentBodyType4):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateAgentResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
