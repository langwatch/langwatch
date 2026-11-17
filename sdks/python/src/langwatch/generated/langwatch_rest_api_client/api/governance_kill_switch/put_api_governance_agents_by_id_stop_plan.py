from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_governance_agents_by_id_stop_plan_body import PutApiGovernanceAgentsByIdStopPlanBody
from ...models.put_api_governance_agents_by_id_stop_plan_response_200 import (
    PutApiGovernanceAgentsByIdStopPlanResponse200,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_400 import (
    PutApiGovernanceAgentsByIdStopPlanResponse400,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_401 import (
    PutApiGovernanceAgentsByIdStopPlanResponse401,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_403 import (
    PutApiGovernanceAgentsByIdStopPlanResponse403,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_404 import (
    PutApiGovernanceAgentsByIdStopPlanResponse404,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_409 import (
    PutApiGovernanceAgentsByIdStopPlanResponse409,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_422 import (
    PutApiGovernanceAgentsByIdStopPlanResponse422,
)
from ...models.put_api_governance_agents_by_id_stop_plan_response_500 import (
    PutApiGovernanceAgentsByIdStopPlanResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    agent_id: str,
    *,
    body: PutApiGovernanceAgentsByIdStopPlanBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/governance/agents/{agent_id}/stop-plan".format(
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
    PutApiGovernanceAgentsByIdStopPlanResponse200
    | PutApiGovernanceAgentsByIdStopPlanResponse400
    | PutApiGovernanceAgentsByIdStopPlanResponse401
    | PutApiGovernanceAgentsByIdStopPlanResponse403
    | PutApiGovernanceAgentsByIdStopPlanResponse404
    | PutApiGovernanceAgentsByIdStopPlanResponse409
    | PutApiGovernanceAgentsByIdStopPlanResponse422
    | PutApiGovernanceAgentsByIdStopPlanResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiGovernanceAgentsByIdStopPlanResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiGovernanceAgentsByIdStopPlanResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiGovernanceAgentsByIdStopPlanResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PutApiGovernanceAgentsByIdStopPlanResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PutApiGovernanceAgentsByIdStopPlanResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PutApiGovernanceAgentsByIdStopPlanResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PutApiGovernanceAgentsByIdStopPlanResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiGovernanceAgentsByIdStopPlanResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiGovernanceAgentsByIdStopPlanResponse200
    | PutApiGovernanceAgentsByIdStopPlanResponse400
    | PutApiGovernanceAgentsByIdStopPlanResponse401
    | PutApiGovernanceAgentsByIdStopPlanResponse403
    | PutApiGovernanceAgentsByIdStopPlanResponse404
    | PutApiGovernanceAgentsByIdStopPlanResponse409
    | PutApiGovernanceAgentsByIdStopPlanResponse422
    | PutApiGovernanceAgentsByIdStopPlanResponse500
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
    body: PutApiGovernanceAgentsByIdStopPlanBody,
) -> Response[
    PutApiGovernanceAgentsByIdStopPlanResponse200
    | PutApiGovernanceAgentsByIdStopPlanResponse400
    | PutApiGovernanceAgentsByIdStopPlanResponse401
    | PutApiGovernanceAgentsByIdStopPlanResponse403
    | PutApiGovernanceAgentsByIdStopPlanResponse404
    | PutApiGovernanceAgentsByIdStopPlanResponse409
    | PutApiGovernanceAgentsByIdStopPlanResponse422
    | PutApiGovernanceAgentsByIdStopPlanResponse500
]:
    """Replace an agent's stop plan

     Replaces every target at once; an empty list clears the plan. Each target must name what the
    organisation holds: a Databricks governance source, a stored AWS connection or a gateway virtual
    key. Anything else is a 422 `agent_stop_target_invalid` naming the target's position. Send
    `expectedVersion` with the `version` you read to refuse the save (409 `agent_stop_plan_conflict`)
    when someone else saved the plan since. A target removed from the plan also leaves the agent's open
    stop, so it no longer holds that stop or its restore from finishing; a restore leaves it as it is.

    Args:
        agent_id (str):
        body (PutApiGovernanceAgentsByIdStopPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiGovernanceAgentsByIdStopPlanResponse200 | PutApiGovernanceAgentsByIdStopPlanResponse400 | PutApiGovernanceAgentsByIdStopPlanResponse401 | PutApiGovernanceAgentsByIdStopPlanResponse403 | PutApiGovernanceAgentsByIdStopPlanResponse404 | PutApiGovernanceAgentsByIdStopPlanResponse409 | PutApiGovernanceAgentsByIdStopPlanResponse422 | PutApiGovernanceAgentsByIdStopPlanResponse500]
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
    body: PutApiGovernanceAgentsByIdStopPlanBody,
) -> (
    PutApiGovernanceAgentsByIdStopPlanResponse200
    | PutApiGovernanceAgentsByIdStopPlanResponse400
    | PutApiGovernanceAgentsByIdStopPlanResponse401
    | PutApiGovernanceAgentsByIdStopPlanResponse403
    | PutApiGovernanceAgentsByIdStopPlanResponse404
    | PutApiGovernanceAgentsByIdStopPlanResponse409
    | PutApiGovernanceAgentsByIdStopPlanResponse422
    | PutApiGovernanceAgentsByIdStopPlanResponse500
    | None
):
    """Replace an agent's stop plan

     Replaces every target at once; an empty list clears the plan. Each target must name what the
    organisation holds: a Databricks governance source, a stored AWS connection or a gateway virtual
    key. Anything else is a 422 `agent_stop_target_invalid` naming the target's position. Send
    `expectedVersion` with the `version` you read to refuse the save (409 `agent_stop_plan_conflict`)
    when someone else saved the plan since. A target removed from the plan also leaves the agent's open
    stop, so it no longer holds that stop or its restore from finishing; a restore leaves it as it is.

    Args:
        agent_id (str):
        body (PutApiGovernanceAgentsByIdStopPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiGovernanceAgentsByIdStopPlanResponse200 | PutApiGovernanceAgentsByIdStopPlanResponse400 | PutApiGovernanceAgentsByIdStopPlanResponse401 | PutApiGovernanceAgentsByIdStopPlanResponse403 | PutApiGovernanceAgentsByIdStopPlanResponse404 | PutApiGovernanceAgentsByIdStopPlanResponse409 | PutApiGovernanceAgentsByIdStopPlanResponse422 | PutApiGovernanceAgentsByIdStopPlanResponse500
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
    body: PutApiGovernanceAgentsByIdStopPlanBody,
) -> Response[
    PutApiGovernanceAgentsByIdStopPlanResponse200
    | PutApiGovernanceAgentsByIdStopPlanResponse400
    | PutApiGovernanceAgentsByIdStopPlanResponse401
    | PutApiGovernanceAgentsByIdStopPlanResponse403
    | PutApiGovernanceAgentsByIdStopPlanResponse404
    | PutApiGovernanceAgentsByIdStopPlanResponse409
    | PutApiGovernanceAgentsByIdStopPlanResponse422
    | PutApiGovernanceAgentsByIdStopPlanResponse500
]:
    """Replace an agent's stop plan

     Replaces every target at once; an empty list clears the plan. Each target must name what the
    organisation holds: a Databricks governance source, a stored AWS connection or a gateway virtual
    key. Anything else is a 422 `agent_stop_target_invalid` naming the target's position. Send
    `expectedVersion` with the `version` you read to refuse the save (409 `agent_stop_plan_conflict`)
    when someone else saved the plan since. A target removed from the plan also leaves the agent's open
    stop, so it no longer holds that stop or its restore from finishing; a restore leaves it as it is.

    Args:
        agent_id (str):
        body (PutApiGovernanceAgentsByIdStopPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiGovernanceAgentsByIdStopPlanResponse200 | PutApiGovernanceAgentsByIdStopPlanResponse400 | PutApiGovernanceAgentsByIdStopPlanResponse401 | PutApiGovernanceAgentsByIdStopPlanResponse403 | PutApiGovernanceAgentsByIdStopPlanResponse404 | PutApiGovernanceAgentsByIdStopPlanResponse409 | PutApiGovernanceAgentsByIdStopPlanResponse422 | PutApiGovernanceAgentsByIdStopPlanResponse500]
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
    body: PutApiGovernanceAgentsByIdStopPlanBody,
) -> (
    PutApiGovernanceAgentsByIdStopPlanResponse200
    | PutApiGovernanceAgentsByIdStopPlanResponse400
    | PutApiGovernanceAgentsByIdStopPlanResponse401
    | PutApiGovernanceAgentsByIdStopPlanResponse403
    | PutApiGovernanceAgentsByIdStopPlanResponse404
    | PutApiGovernanceAgentsByIdStopPlanResponse409
    | PutApiGovernanceAgentsByIdStopPlanResponse422
    | PutApiGovernanceAgentsByIdStopPlanResponse500
    | None
):
    """Replace an agent's stop plan

     Replaces every target at once; an empty list clears the plan. Each target must name what the
    organisation holds: a Databricks governance source, a stored AWS connection or a gateway virtual
    key. Anything else is a 422 `agent_stop_target_invalid` naming the target's position. Send
    `expectedVersion` with the `version` you read to refuse the save (409 `agent_stop_plan_conflict`)
    when someone else saved the plan since. A target removed from the plan also leaves the agent's open
    stop, so it no longer holds that stop or its restore from finishing; a restore leaves it as it is.

    Args:
        agent_id (str):
        body (PutApiGovernanceAgentsByIdStopPlanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiGovernanceAgentsByIdStopPlanResponse200 | PutApiGovernanceAgentsByIdStopPlanResponse400 | PutApiGovernanceAgentsByIdStopPlanResponse401 | PutApiGovernanceAgentsByIdStopPlanResponse403 | PutApiGovernanceAgentsByIdStopPlanResponse404 | PutApiGovernanceAgentsByIdStopPlanResponse409 | PutApiGovernanceAgentsByIdStopPlanResponse422 | PutApiGovernanceAgentsByIdStopPlanResponse500
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
            body=body,
        )
    ).parsed
