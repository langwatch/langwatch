from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.assign_agent_label_body import AssignAgentLabelBody
from ...models.assign_agent_label_response_200 import AssignAgentLabelResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    agent_id: str,
    label: str,
    *,
    body: AssignAgentLabelBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/agents/{agent_id}/labels/{label}".format(
            agent_id=quote(str(agent_id), safe=""),
            label=quote(str(label), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> AssignAgentLabelResponse200 | None:
    if response.status_code == 200:
        response_200 = AssignAgentLabelResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[AssignAgentLabelResponse200]:
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
    agent_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: AssignAgentLabelBody,
) -> Response[AssignAgentLabelResponse200]:
    """Point a deploy label, such as production, at one of the agent's versions

    Args:
        agent_id (str):
        label (str):
        body (AssignAgentLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AssignAgentLabelResponse200]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        label=label,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: AssignAgentLabelBody,
) -> AssignAgentLabelResponse200 | None:
    """Point a deploy label, such as production, at one of the agent's versions

    Args:
        agent_id (str):
        label (str):
        body (AssignAgentLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AssignAgentLabelResponse200
    """

    return sync_detailed(
        agent_id=agent_id,
        label=label,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: AssignAgentLabelBody,
) -> Response[AssignAgentLabelResponse200]:
    """Point a deploy label, such as production, at one of the agent's versions

    Args:
        agent_id (str):
        label (str):
        body (AssignAgentLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AssignAgentLabelResponse200]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        label=label,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: AssignAgentLabelBody,
) -> AssignAgentLabelResponse200 | None:
    """Point a deploy label, such as production, at one of the agent's versions

    Args:
        agent_id (str):
        label (str):
        body (AssignAgentLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AssignAgentLabelResponse200
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            label=label,
            client=client,
            body=body,
        )
    ).parsed
