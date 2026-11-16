from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_agents_by_id_stop_body import PostApiGovernanceAgentsByIdStopBody
from ...models.post_api_governance_agents_by_id_stop_response_202 import PostApiGovernanceAgentsByIdStopResponse202
from ...models.post_api_governance_agents_by_id_stop_response_400 import PostApiGovernanceAgentsByIdStopResponse400
from ...models.post_api_governance_agents_by_id_stop_response_401 import PostApiGovernanceAgentsByIdStopResponse401
from ...models.post_api_governance_agents_by_id_stop_response_403 import PostApiGovernanceAgentsByIdStopResponse403
from ...models.post_api_governance_agents_by_id_stop_response_404 import PostApiGovernanceAgentsByIdStopResponse404
from ...models.post_api_governance_agents_by_id_stop_response_409 import PostApiGovernanceAgentsByIdStopResponse409
from ...models.post_api_governance_agents_by_id_stop_response_422 import PostApiGovernanceAgentsByIdStopResponse422
from ...models.post_api_governance_agents_by_id_stop_response_500 import PostApiGovernanceAgentsByIdStopResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    agent_id: str,
    *,
    body: PostApiGovernanceAgentsByIdStopBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/agents/{agent_id}/stop".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceAgentsByIdStopResponse202
    | PostApiGovernanceAgentsByIdStopResponse400
    | PostApiGovernanceAgentsByIdStopResponse401
    | PostApiGovernanceAgentsByIdStopResponse403
    | PostApiGovernanceAgentsByIdStopResponse404
    | PostApiGovernanceAgentsByIdStopResponse409
    | PostApiGovernanceAgentsByIdStopResponse422
    | PostApiGovernanceAgentsByIdStopResponse500
    | None
):
    if response.status_code == 202:
        response_202 = PostApiGovernanceAgentsByIdStopResponse202.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = PostApiGovernanceAgentsByIdStopResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceAgentsByIdStopResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceAgentsByIdStopResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiGovernanceAgentsByIdStopResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostApiGovernanceAgentsByIdStopResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiGovernanceAgentsByIdStopResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceAgentsByIdStopResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceAgentsByIdStopResponse202
    | PostApiGovernanceAgentsByIdStopResponse400
    | PostApiGovernanceAgentsByIdStopResponse401
    | PostApiGovernanceAgentsByIdStopResponse403
    | PostApiGovernanceAgentsByIdStopResponse404
    | PostApiGovernanceAgentsByIdStopResponse409
    | PostApiGovernanceAgentsByIdStopResponse422
    | PostApiGovernanceAgentsByIdStopResponse500
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
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentsByIdStopBody,
) -> Response[
    PostApiGovernanceAgentsByIdStopResponse202
    | PostApiGovernanceAgentsByIdStopResponse400
    | PostApiGovernanceAgentsByIdStopResponse401
    | PostApiGovernanceAgentsByIdStopResponse403
    | PostApiGovernanceAgentsByIdStopResponse404
    | PostApiGovernanceAgentsByIdStopResponse409
    | PostApiGovernanceAgentsByIdStopResponse422
    | PostApiGovernanceAgentsByIdStopResponse500
]:
    """Stop an agent

     Requests a stop of the agent on every target of its plan. Send `expectedTargetIds` with the plan's
    target ids to refuse the stop (`agent_stop_plan_changed`) when the plan changed since you read it. A
    `critical` stop is applied at once; any other severity waits for an approval by another credential
    (`status: pending_approval`). The targets are applied in the background: read the stop back to
    follow each target's outcome. A trace rule's webhook action can post here with the API key in its
    `Authorization` header.

    Args:
        agent_id (str):
        body (PostApiGovernanceAgentsByIdStopBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentsByIdStopResponse202 | PostApiGovernanceAgentsByIdStopResponse400 | PostApiGovernanceAgentsByIdStopResponse401 | PostApiGovernanceAgentsByIdStopResponse403 | PostApiGovernanceAgentsByIdStopResponse404 | PostApiGovernanceAgentsByIdStopResponse409 | PostApiGovernanceAgentsByIdStopResponse422 | PostApiGovernanceAgentsByIdStopResponse500]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentsByIdStopBody,
) -> (
    PostApiGovernanceAgentsByIdStopResponse202
    | PostApiGovernanceAgentsByIdStopResponse400
    | PostApiGovernanceAgentsByIdStopResponse401
    | PostApiGovernanceAgentsByIdStopResponse403
    | PostApiGovernanceAgentsByIdStopResponse404
    | PostApiGovernanceAgentsByIdStopResponse409
    | PostApiGovernanceAgentsByIdStopResponse422
    | PostApiGovernanceAgentsByIdStopResponse500
    | None
):
    """Stop an agent

     Requests a stop of the agent on every target of its plan. Send `expectedTargetIds` with the plan's
    target ids to refuse the stop (`agent_stop_plan_changed`) when the plan changed since you read it. A
    `critical` stop is applied at once; any other severity waits for an approval by another credential
    (`status: pending_approval`). The targets are applied in the background: read the stop back to
    follow each target's outcome. A trace rule's webhook action can post here with the API key in its
    `Authorization` header.

    Args:
        agent_id (str):
        body (PostApiGovernanceAgentsByIdStopBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentsByIdStopResponse202 | PostApiGovernanceAgentsByIdStopResponse400 | PostApiGovernanceAgentsByIdStopResponse401 | PostApiGovernanceAgentsByIdStopResponse403 | PostApiGovernanceAgentsByIdStopResponse404 | PostApiGovernanceAgentsByIdStopResponse409 | PostApiGovernanceAgentsByIdStopResponse422 | PostApiGovernanceAgentsByIdStopResponse500
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentsByIdStopBody,
) -> Response[
    PostApiGovernanceAgentsByIdStopResponse202
    | PostApiGovernanceAgentsByIdStopResponse400
    | PostApiGovernanceAgentsByIdStopResponse401
    | PostApiGovernanceAgentsByIdStopResponse403
    | PostApiGovernanceAgentsByIdStopResponse404
    | PostApiGovernanceAgentsByIdStopResponse409
    | PostApiGovernanceAgentsByIdStopResponse422
    | PostApiGovernanceAgentsByIdStopResponse500
]:
    """Stop an agent

     Requests a stop of the agent on every target of its plan. Send `expectedTargetIds` with the plan's
    target ids to refuse the stop (`agent_stop_plan_changed`) when the plan changed since you read it. A
    `critical` stop is applied at once; any other severity waits for an approval by another credential
    (`status: pending_approval`). The targets are applied in the background: read the stop back to
    follow each target's outcome. A trace rule's webhook action can post here with the API key in its
    `Authorization` header.

    Args:
        agent_id (str):
        body (PostApiGovernanceAgentsByIdStopBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentsByIdStopResponse202 | PostApiGovernanceAgentsByIdStopResponse400 | PostApiGovernanceAgentsByIdStopResponse401 | PostApiGovernanceAgentsByIdStopResponse403 | PostApiGovernanceAgentsByIdStopResponse404 | PostApiGovernanceAgentsByIdStopResponse409 | PostApiGovernanceAgentsByIdStopResponse422 | PostApiGovernanceAgentsByIdStopResponse500]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentsByIdStopBody,
) -> (
    PostApiGovernanceAgentsByIdStopResponse202
    | PostApiGovernanceAgentsByIdStopResponse400
    | PostApiGovernanceAgentsByIdStopResponse401
    | PostApiGovernanceAgentsByIdStopResponse403
    | PostApiGovernanceAgentsByIdStopResponse404
    | PostApiGovernanceAgentsByIdStopResponse409
    | PostApiGovernanceAgentsByIdStopResponse422
    | PostApiGovernanceAgentsByIdStopResponse500
    | None
):
    """Stop an agent

     Requests a stop of the agent on every target of its plan. Send `expectedTargetIds` with the plan's
    target ids to refuse the stop (`agent_stop_plan_changed`) when the plan changed since you read it. A
    `critical` stop is applied at once; any other severity waits for an approval by another credential
    (`status: pending_approval`). The targets are applied in the background: read the stop back to
    follow each target's outcome. A trace rule's webhook action can post here with the API key in its
    `Authorization` header.

    Args:
        agent_id (str):
        body (PostApiGovernanceAgentsByIdStopBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentsByIdStopResponse202 | PostApiGovernanceAgentsByIdStopResponse400 | PostApiGovernanceAgentsByIdStopResponse401 | PostApiGovernanceAgentsByIdStopResponse403 | PostApiGovernanceAgentsByIdStopResponse404 | PostApiGovernanceAgentsByIdStopResponse409 | PostApiGovernanceAgentsByIdStopResponse422 | PostApiGovernanceAgentsByIdStopResponse500
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
            body=body,
        )
    ).parsed
