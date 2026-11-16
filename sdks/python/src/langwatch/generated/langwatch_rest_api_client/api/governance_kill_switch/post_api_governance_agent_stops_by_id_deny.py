from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_agent_stops_by_id_deny_body import PostApiGovernanceAgentStopsByIdDenyBody
from ...models.post_api_governance_agent_stops_by_id_deny_response_200 import (
    PostApiGovernanceAgentStopsByIdDenyResponse200,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_400 import (
    PostApiGovernanceAgentStopsByIdDenyResponse400,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_401 import (
    PostApiGovernanceAgentStopsByIdDenyResponse401,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_403 import (
    PostApiGovernanceAgentStopsByIdDenyResponse403,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_404 import (
    PostApiGovernanceAgentStopsByIdDenyResponse404,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_409 import (
    PostApiGovernanceAgentStopsByIdDenyResponse409,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_422 import (
    PostApiGovernanceAgentStopsByIdDenyResponse422,
)
from ...models.post_api_governance_agent_stops_by_id_deny_response_500 import (
    PostApiGovernanceAgentStopsByIdDenyResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    stop_id: str,
    *,
    body: PostApiGovernanceAgentStopsByIdDenyBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/agent-stops/{stop_id}/deny".format(
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
    PostApiGovernanceAgentStopsByIdDenyResponse200
    | PostApiGovernanceAgentStopsByIdDenyResponse400
    | PostApiGovernanceAgentStopsByIdDenyResponse401
    | PostApiGovernanceAgentStopsByIdDenyResponse403
    | PostApiGovernanceAgentStopsByIdDenyResponse404
    | PostApiGovernanceAgentStopsByIdDenyResponse409
    | PostApiGovernanceAgentStopsByIdDenyResponse422
    | PostApiGovernanceAgentStopsByIdDenyResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGovernanceAgentStopsByIdDenyResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGovernanceAgentStopsByIdDenyResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceAgentStopsByIdDenyResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceAgentStopsByIdDenyResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiGovernanceAgentStopsByIdDenyResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostApiGovernanceAgentStopsByIdDenyResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiGovernanceAgentStopsByIdDenyResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceAgentStopsByIdDenyResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceAgentStopsByIdDenyResponse200
    | PostApiGovernanceAgentStopsByIdDenyResponse400
    | PostApiGovernanceAgentStopsByIdDenyResponse401
    | PostApiGovernanceAgentStopsByIdDenyResponse403
    | PostApiGovernanceAgentStopsByIdDenyResponse404
    | PostApiGovernanceAgentStopsByIdDenyResponse409
    | PostApiGovernanceAgentStopsByIdDenyResponse422
    | PostApiGovernanceAgentStopsByIdDenyResponse500
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
    body: PostApiGovernanceAgentStopsByIdDenyBody | Unset = UNSET,
) -> Response[
    PostApiGovernanceAgentStopsByIdDenyResponse200
    | PostApiGovernanceAgentStopsByIdDenyResponse400
    | PostApiGovernanceAgentStopsByIdDenyResponse401
    | PostApiGovernanceAgentStopsByIdDenyResponse403
    | PostApiGovernanceAgentStopsByIdDenyResponse404
    | PostApiGovernanceAgentStopsByIdDenyResponse409
    | PostApiGovernanceAgentStopsByIdDenyResponse422
    | PostApiGovernanceAgentStopsByIdDenyResponse500
]:
    """Deny a pending stop

     Denies a stop waiting for a decision; no target is applied. A stop that is no longer pending is a
    409 `agent_stop_not_pending`.

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdDenyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdDenyResponse200 | PostApiGovernanceAgentStopsByIdDenyResponse400 | PostApiGovernanceAgentStopsByIdDenyResponse401 | PostApiGovernanceAgentStopsByIdDenyResponse403 | PostApiGovernanceAgentStopsByIdDenyResponse404 | PostApiGovernanceAgentStopsByIdDenyResponse409 | PostApiGovernanceAgentStopsByIdDenyResponse422 | PostApiGovernanceAgentStopsByIdDenyResponse500]
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
    body: PostApiGovernanceAgentStopsByIdDenyBody | Unset = UNSET,
) -> (
    PostApiGovernanceAgentStopsByIdDenyResponse200
    | PostApiGovernanceAgentStopsByIdDenyResponse400
    | PostApiGovernanceAgentStopsByIdDenyResponse401
    | PostApiGovernanceAgentStopsByIdDenyResponse403
    | PostApiGovernanceAgentStopsByIdDenyResponse404
    | PostApiGovernanceAgentStopsByIdDenyResponse409
    | PostApiGovernanceAgentStopsByIdDenyResponse422
    | PostApiGovernanceAgentStopsByIdDenyResponse500
    | None
):
    """Deny a pending stop

     Denies a stop waiting for a decision; no target is applied. A stop that is no longer pending is a
    409 `agent_stop_not_pending`.

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdDenyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdDenyResponse200 | PostApiGovernanceAgentStopsByIdDenyResponse400 | PostApiGovernanceAgentStopsByIdDenyResponse401 | PostApiGovernanceAgentStopsByIdDenyResponse403 | PostApiGovernanceAgentStopsByIdDenyResponse404 | PostApiGovernanceAgentStopsByIdDenyResponse409 | PostApiGovernanceAgentStopsByIdDenyResponse422 | PostApiGovernanceAgentStopsByIdDenyResponse500
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
    body: PostApiGovernanceAgentStopsByIdDenyBody | Unset = UNSET,
) -> Response[
    PostApiGovernanceAgentStopsByIdDenyResponse200
    | PostApiGovernanceAgentStopsByIdDenyResponse400
    | PostApiGovernanceAgentStopsByIdDenyResponse401
    | PostApiGovernanceAgentStopsByIdDenyResponse403
    | PostApiGovernanceAgentStopsByIdDenyResponse404
    | PostApiGovernanceAgentStopsByIdDenyResponse409
    | PostApiGovernanceAgentStopsByIdDenyResponse422
    | PostApiGovernanceAgentStopsByIdDenyResponse500
]:
    """Deny a pending stop

     Denies a stop waiting for a decision; no target is applied. A stop that is no longer pending is a
    409 `agent_stop_not_pending`.

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdDenyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdDenyResponse200 | PostApiGovernanceAgentStopsByIdDenyResponse400 | PostApiGovernanceAgentStopsByIdDenyResponse401 | PostApiGovernanceAgentStopsByIdDenyResponse403 | PostApiGovernanceAgentStopsByIdDenyResponse404 | PostApiGovernanceAgentStopsByIdDenyResponse409 | PostApiGovernanceAgentStopsByIdDenyResponse422 | PostApiGovernanceAgentStopsByIdDenyResponse500]
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
    body: PostApiGovernanceAgentStopsByIdDenyBody | Unset = UNSET,
) -> (
    PostApiGovernanceAgentStopsByIdDenyResponse200
    | PostApiGovernanceAgentStopsByIdDenyResponse400
    | PostApiGovernanceAgentStopsByIdDenyResponse401
    | PostApiGovernanceAgentStopsByIdDenyResponse403
    | PostApiGovernanceAgentStopsByIdDenyResponse404
    | PostApiGovernanceAgentStopsByIdDenyResponse409
    | PostApiGovernanceAgentStopsByIdDenyResponse422
    | PostApiGovernanceAgentStopsByIdDenyResponse500
    | None
):
    """Deny a pending stop

     Denies a stop waiting for a decision; no target is applied. A stop that is no longer pending is a
    409 `agent_stop_not_pending`.

    Args:
        stop_id (str):
        body (PostApiGovernanceAgentStopsByIdDenyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdDenyResponse200 | PostApiGovernanceAgentStopsByIdDenyResponse400 | PostApiGovernanceAgentStopsByIdDenyResponse401 | PostApiGovernanceAgentStopsByIdDenyResponse403 | PostApiGovernanceAgentStopsByIdDenyResponse404 | PostApiGovernanceAgentStopsByIdDenyResponse409 | PostApiGovernanceAgentStopsByIdDenyResponse422 | PostApiGovernanceAgentStopsByIdDenyResponse500
    """

    return (
        await asyncio_detailed(
            stop_id=stop_id,
            client=client,
            body=body,
        )
    ).parsed
