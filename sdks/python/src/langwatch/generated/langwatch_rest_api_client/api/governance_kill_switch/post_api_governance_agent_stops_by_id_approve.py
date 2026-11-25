from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_agent_stops_by_id_approve_body import PostApiGovernanceAgentStopsByIdApproveBody
from ...models.post_api_governance_agent_stops_by_id_approve_response_200 import (
    PostApiGovernanceAgentStopsByIdApproveResponse200,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_400 import (
    PostApiGovernanceAgentStopsByIdApproveResponse400,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_401 import (
    PostApiGovernanceAgentStopsByIdApproveResponse401,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_403 import (
    PostApiGovernanceAgentStopsByIdApproveResponse403,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_404 import (
    PostApiGovernanceAgentStopsByIdApproveResponse404,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_409 import (
    PostApiGovernanceAgentStopsByIdApproveResponse409,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_422 import (
    PostApiGovernanceAgentStopsByIdApproveResponse422,
)
from ...models.post_api_governance_agent_stops_by_id_approve_response_500 import (
    PostApiGovernanceAgentStopsByIdApproveResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    stop_id: str,
    *,
    body: PostApiGovernanceAgentStopsByIdApproveBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/agent-stops/{stop_id}/approve".format(
            stop_id=quote(str(stop_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceAgentStopsByIdApproveResponse200
    | PostApiGovernanceAgentStopsByIdApproveResponse400
    | PostApiGovernanceAgentStopsByIdApproveResponse401
    | PostApiGovernanceAgentStopsByIdApproveResponse403
    | PostApiGovernanceAgentStopsByIdApproveResponse404
    | PostApiGovernanceAgentStopsByIdApproveResponse409
    | PostApiGovernanceAgentStopsByIdApproveResponse422
    | PostApiGovernanceAgentStopsByIdApproveResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGovernanceAgentStopsByIdApproveResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGovernanceAgentStopsByIdApproveResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceAgentStopsByIdApproveResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceAgentStopsByIdApproveResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiGovernanceAgentStopsByIdApproveResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostApiGovernanceAgentStopsByIdApproveResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiGovernanceAgentStopsByIdApproveResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceAgentStopsByIdApproveResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceAgentStopsByIdApproveResponse200
    | PostApiGovernanceAgentStopsByIdApproveResponse400
    | PostApiGovernanceAgentStopsByIdApproveResponse401
    | PostApiGovernanceAgentStopsByIdApproveResponse403
    | PostApiGovernanceAgentStopsByIdApproveResponse404
    | PostApiGovernanceAgentStopsByIdApproveResponse409
    | PostApiGovernanceAgentStopsByIdApproveResponse422
    | PostApiGovernanceAgentStopsByIdApproveResponse500
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
    stop_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentStopsByIdApproveBody | Unset = UNSET,
) -> Response[
    PostApiGovernanceAgentStopsByIdApproveResponse200
    | PostApiGovernanceAgentStopsByIdApproveResponse400
    | PostApiGovernanceAgentStopsByIdApproveResponse401
    | PostApiGovernanceAgentStopsByIdApproveResponse403
    | PostApiGovernanceAgentStopsByIdApproveResponse404
    | PostApiGovernanceAgentStopsByIdApproveResponse409
    | PostApiGovernanceAgentStopsByIdApproveResponse422
    | PostApiGovernanceAgentStopsByIdApproveResponse500
]:
    """Approve a pending stop

     Approves a stop waiting for a decision; its targets are then applied. Send `expectedTargetIds` with
    the stop's target ids you reviewed to refuse the approval (409 `agent_stop_plan_changed`) when its
    targets changed since. A stop that is no longer pending is a 409 `agent_stop_not_pending`; the key
    that requested the stop cannot approve it (409 `agent_stop_self_approval`).

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdApproveBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdApproveResponse200 | PostApiGovernanceAgentStopsByIdApproveResponse400 | PostApiGovernanceAgentStopsByIdApproveResponse401 | PostApiGovernanceAgentStopsByIdApproveResponse403 | PostApiGovernanceAgentStopsByIdApproveResponse404 | PostApiGovernanceAgentStopsByIdApproveResponse409 | PostApiGovernanceAgentStopsByIdApproveResponse422 | PostApiGovernanceAgentStopsByIdApproveResponse500]
    """

    kwargs = _get_kwargs(
        stop_id=stop_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    stop_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentStopsByIdApproveBody | Unset = UNSET,
) -> (
    PostApiGovernanceAgentStopsByIdApproveResponse200
    | PostApiGovernanceAgentStopsByIdApproveResponse400
    | PostApiGovernanceAgentStopsByIdApproveResponse401
    | PostApiGovernanceAgentStopsByIdApproveResponse403
    | PostApiGovernanceAgentStopsByIdApproveResponse404
    | PostApiGovernanceAgentStopsByIdApproveResponse409
    | PostApiGovernanceAgentStopsByIdApproveResponse422
    | PostApiGovernanceAgentStopsByIdApproveResponse500
    | None
):
    """Approve a pending stop

     Approves a stop waiting for a decision; its targets are then applied. Send `expectedTargetIds` with
    the stop's target ids you reviewed to refuse the approval (409 `agent_stop_plan_changed`) when its
    targets changed since. A stop that is no longer pending is a 409 `agent_stop_not_pending`; the key
    that requested the stop cannot approve it (409 `agent_stop_self_approval`).

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdApproveBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdApproveResponse200 | PostApiGovernanceAgentStopsByIdApproveResponse400 | PostApiGovernanceAgentStopsByIdApproveResponse401 | PostApiGovernanceAgentStopsByIdApproveResponse403 | PostApiGovernanceAgentStopsByIdApproveResponse404 | PostApiGovernanceAgentStopsByIdApproveResponse409 | PostApiGovernanceAgentStopsByIdApproveResponse422 | PostApiGovernanceAgentStopsByIdApproveResponse500
    """

    return sync_detailed(
        stop_id=stop_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    stop_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentStopsByIdApproveBody | Unset = UNSET,
) -> Response[
    PostApiGovernanceAgentStopsByIdApproveResponse200
    | PostApiGovernanceAgentStopsByIdApproveResponse400
    | PostApiGovernanceAgentStopsByIdApproveResponse401
    | PostApiGovernanceAgentStopsByIdApproveResponse403
    | PostApiGovernanceAgentStopsByIdApproveResponse404
    | PostApiGovernanceAgentStopsByIdApproveResponse409
    | PostApiGovernanceAgentStopsByIdApproveResponse422
    | PostApiGovernanceAgentStopsByIdApproveResponse500
]:
    """Approve a pending stop

     Approves a stop waiting for a decision; its targets are then applied. Send `expectedTargetIds` with
    the stop's target ids you reviewed to refuse the approval (409 `agent_stop_plan_changed`) when its
    targets changed since. A stop that is no longer pending is a 409 `agent_stop_not_pending`; the key
    that requested the stop cannot approve it (409 `agent_stop_self_approval`).

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdApproveBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdApproveResponse200 | PostApiGovernanceAgentStopsByIdApproveResponse400 | PostApiGovernanceAgentStopsByIdApproveResponse401 | PostApiGovernanceAgentStopsByIdApproveResponse403 | PostApiGovernanceAgentStopsByIdApproveResponse404 | PostApiGovernanceAgentStopsByIdApproveResponse409 | PostApiGovernanceAgentStopsByIdApproveResponse422 | PostApiGovernanceAgentStopsByIdApproveResponse500]
    """

    kwargs = _get_kwargs(
        stop_id=stop_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    stop_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceAgentStopsByIdApproveBody | Unset = UNSET,
) -> (
    PostApiGovernanceAgentStopsByIdApproveResponse200
    | PostApiGovernanceAgentStopsByIdApproveResponse400
    | PostApiGovernanceAgentStopsByIdApproveResponse401
    | PostApiGovernanceAgentStopsByIdApproveResponse403
    | PostApiGovernanceAgentStopsByIdApproveResponse404
    | PostApiGovernanceAgentStopsByIdApproveResponse409
    | PostApiGovernanceAgentStopsByIdApproveResponse422
    | PostApiGovernanceAgentStopsByIdApproveResponse500
    | None
):
    """Approve a pending stop

     Approves a stop waiting for a decision; its targets are then applied. Send `expectedTargetIds` with
    the stop's target ids you reviewed to refuse the approval (409 `agent_stop_plan_changed`) when its
    targets changed since. A stop that is no longer pending is a 409 `agent_stop_not_pending`; the key
    that requested the stop cannot approve it (409 `agent_stop_self_approval`).

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdApproveBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdApproveResponse200 | PostApiGovernanceAgentStopsByIdApproveResponse400 | PostApiGovernanceAgentStopsByIdApproveResponse401 | PostApiGovernanceAgentStopsByIdApproveResponse403 | PostApiGovernanceAgentStopsByIdApproveResponse404 | PostApiGovernanceAgentStopsByIdApproveResponse409 | PostApiGovernanceAgentStopsByIdApproveResponse422 | PostApiGovernanceAgentStopsByIdApproveResponse500
    """

    return (
        await asyncio_detailed(
            stop_id=stop_id,
            client=client,
            body=body,
        )
    ).parsed
