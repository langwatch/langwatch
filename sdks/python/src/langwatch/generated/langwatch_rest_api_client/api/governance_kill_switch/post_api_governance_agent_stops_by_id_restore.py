from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_agent_stops_by_id_restore_response_202 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse202,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_400 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse400,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_401 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse401,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_403 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse403,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_404 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse404,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_409 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse409,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_422 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse422,
)
from ...models.post_api_governance_agent_stops_by_id_restore_response_500 import (
    PostApiGovernanceAgentStopsByIdRestoreResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    stop_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/agent-stops/{stop_id}/restore".format(
            stop_id=quote(str(stop_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceAgentStopsByIdRestoreResponse202
    | PostApiGovernanceAgentStopsByIdRestoreResponse400
    | PostApiGovernanceAgentStopsByIdRestoreResponse401
    | PostApiGovernanceAgentStopsByIdRestoreResponse403
    | PostApiGovernanceAgentStopsByIdRestoreResponse404
    | PostApiGovernanceAgentStopsByIdRestoreResponse409
    | PostApiGovernanceAgentStopsByIdRestoreResponse422
    | PostApiGovernanceAgentStopsByIdRestoreResponse500
    | None
):
    if response.status_code == 202:
        response_202 = PostApiGovernanceAgentStopsByIdRestoreResponse202.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = PostApiGovernanceAgentStopsByIdRestoreResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceAgentStopsByIdRestoreResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceAgentStopsByIdRestoreResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiGovernanceAgentStopsByIdRestoreResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostApiGovernanceAgentStopsByIdRestoreResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiGovernanceAgentStopsByIdRestoreResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceAgentStopsByIdRestoreResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceAgentStopsByIdRestoreResponse202
    | PostApiGovernanceAgentStopsByIdRestoreResponse400
    | PostApiGovernanceAgentStopsByIdRestoreResponse401
    | PostApiGovernanceAgentStopsByIdRestoreResponse403
    | PostApiGovernanceAgentStopsByIdRestoreResponse404
    | PostApiGovernanceAgentStopsByIdRestoreResponse409
    | PostApiGovernanceAgentStopsByIdRestoreResponse422
    | PostApiGovernanceAgentStopsByIdRestoreResponse500
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
) -> Response[
    PostApiGovernanceAgentStopsByIdRestoreResponse202
    | PostApiGovernanceAgentStopsByIdRestoreResponse400
    | PostApiGovernanceAgentStopsByIdRestoreResponse401
    | PostApiGovernanceAgentStopsByIdRestoreResponse403
    | PostApiGovernanceAgentStopsByIdRestoreResponse404
    | PostApiGovernanceAgentStopsByIdRestoreResponse409
    | PostApiGovernanceAgentStopsByIdRestoreResponse422
    | PostApiGovernanceAgentStopsByIdRestoreResponse500
]:
    """Restore a stopped agent

     Reverts the targets the stop applied: serving endpoints are started, Bedrock aliases accept
    invocations again and virtual keys are enabled. Targets the stop failed to apply are left alone.
    Only a `quarantined`, `stop_failed` or `restore_failed` stop can be restored (409
    `agent_stop_not_restorable`).

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdRestoreResponse202 | PostApiGovernanceAgentStopsByIdRestoreResponse400 | PostApiGovernanceAgentStopsByIdRestoreResponse401 | PostApiGovernanceAgentStopsByIdRestoreResponse403 | PostApiGovernanceAgentStopsByIdRestoreResponse404 | PostApiGovernanceAgentStopsByIdRestoreResponse409 | PostApiGovernanceAgentStopsByIdRestoreResponse422 | PostApiGovernanceAgentStopsByIdRestoreResponse500]
    """

    kwargs = _get_kwargs(
        stop_id=stop_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    stop_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiGovernanceAgentStopsByIdRestoreResponse202
    | PostApiGovernanceAgentStopsByIdRestoreResponse400
    | PostApiGovernanceAgentStopsByIdRestoreResponse401
    | PostApiGovernanceAgentStopsByIdRestoreResponse403
    | PostApiGovernanceAgentStopsByIdRestoreResponse404
    | PostApiGovernanceAgentStopsByIdRestoreResponse409
    | PostApiGovernanceAgentStopsByIdRestoreResponse422
    | PostApiGovernanceAgentStopsByIdRestoreResponse500
    | None
):
    """Restore a stopped agent

     Reverts the targets the stop applied: serving endpoints are started, Bedrock aliases accept
    invocations again and virtual keys are enabled. Targets the stop failed to apply are left alone.
    Only a `quarantined`, `stop_failed` or `restore_failed` stop can be restored (409
    `agent_stop_not_restorable`).

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdRestoreResponse202 | PostApiGovernanceAgentStopsByIdRestoreResponse400 | PostApiGovernanceAgentStopsByIdRestoreResponse401 | PostApiGovernanceAgentStopsByIdRestoreResponse403 | PostApiGovernanceAgentStopsByIdRestoreResponse404 | PostApiGovernanceAgentStopsByIdRestoreResponse409 | PostApiGovernanceAgentStopsByIdRestoreResponse422 | PostApiGovernanceAgentStopsByIdRestoreResponse500
    """

    return sync_detailed(
        stop_id=stop_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    stop_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiGovernanceAgentStopsByIdRestoreResponse202
    | PostApiGovernanceAgentStopsByIdRestoreResponse400
    | PostApiGovernanceAgentStopsByIdRestoreResponse401
    | PostApiGovernanceAgentStopsByIdRestoreResponse403
    | PostApiGovernanceAgentStopsByIdRestoreResponse404
    | PostApiGovernanceAgentStopsByIdRestoreResponse409
    | PostApiGovernanceAgentStopsByIdRestoreResponse422
    | PostApiGovernanceAgentStopsByIdRestoreResponse500
]:
    """Restore a stopped agent

     Reverts the targets the stop applied: serving endpoints are started, Bedrock aliases accept
    invocations again and virtual keys are enabled. Targets the stop failed to apply are left alone.
    Only a `quarantined`, `stop_failed` or `restore_failed` stop can be restored (409
    `agent_stop_not_restorable`).

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdRestoreResponse202 | PostApiGovernanceAgentStopsByIdRestoreResponse400 | PostApiGovernanceAgentStopsByIdRestoreResponse401 | PostApiGovernanceAgentStopsByIdRestoreResponse403 | PostApiGovernanceAgentStopsByIdRestoreResponse404 | PostApiGovernanceAgentStopsByIdRestoreResponse409 | PostApiGovernanceAgentStopsByIdRestoreResponse422 | PostApiGovernanceAgentStopsByIdRestoreResponse500]
    """

    kwargs = _get_kwargs(
        stop_id=stop_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    stop_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiGovernanceAgentStopsByIdRestoreResponse202
    | PostApiGovernanceAgentStopsByIdRestoreResponse400
    | PostApiGovernanceAgentStopsByIdRestoreResponse401
    | PostApiGovernanceAgentStopsByIdRestoreResponse403
    | PostApiGovernanceAgentStopsByIdRestoreResponse404
    | PostApiGovernanceAgentStopsByIdRestoreResponse409
    | PostApiGovernanceAgentStopsByIdRestoreResponse422
    | PostApiGovernanceAgentStopsByIdRestoreResponse500
    | None
):
    """Restore a stopped agent

     Reverts the targets the stop applied: serving endpoints are started, Bedrock aliases accept
    invocations again and virtual keys are enabled. Targets the stop failed to apply are left alone.
    Only a `quarantined`, `stop_failed` or `restore_failed` stop can be restored (409
    `agent_stop_not_restorable`).

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdRestoreResponse202 | PostApiGovernanceAgentStopsByIdRestoreResponse400 | PostApiGovernanceAgentStopsByIdRestoreResponse401 | PostApiGovernanceAgentStopsByIdRestoreResponse403 | PostApiGovernanceAgentStopsByIdRestoreResponse404 | PostApiGovernanceAgentStopsByIdRestoreResponse409 | PostApiGovernanceAgentStopsByIdRestoreResponse422 | PostApiGovernanceAgentStopsByIdRestoreResponse500
    """

    return (
        await asyncio_detailed(
            stop_id=stop_id,
            client=client,
        )
    ).parsed
