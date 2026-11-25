from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_agent_stops_by_id_retry_response_202 import (
    PostApiGovernanceAgentStopsByIdRetryResponse202,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_400 import (
    PostApiGovernanceAgentStopsByIdRetryResponse400,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_401 import (
    PostApiGovernanceAgentStopsByIdRetryResponse401,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_403 import (
    PostApiGovernanceAgentStopsByIdRetryResponse403,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_404 import (
    PostApiGovernanceAgentStopsByIdRetryResponse404,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_409 import (
    PostApiGovernanceAgentStopsByIdRetryResponse409,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_422 import (
    PostApiGovernanceAgentStopsByIdRetryResponse422,
)
from ...models.post_api_governance_agent_stops_by_id_retry_response_500 import (
    PostApiGovernanceAgentStopsByIdRetryResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    stop_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/agent-stops/{stop_id}/retry".format(
            stop_id=quote(str(stop_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceAgentStopsByIdRetryResponse202
    | PostApiGovernanceAgentStopsByIdRetryResponse400
    | PostApiGovernanceAgentStopsByIdRetryResponse401
    | PostApiGovernanceAgentStopsByIdRetryResponse403
    | PostApiGovernanceAgentStopsByIdRetryResponse404
    | PostApiGovernanceAgentStopsByIdRetryResponse409
    | PostApiGovernanceAgentStopsByIdRetryResponse422
    | PostApiGovernanceAgentStopsByIdRetryResponse500
    | None
):
    if response.status_code == 202:
        response_202 = PostApiGovernanceAgentStopsByIdRetryResponse202.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = PostApiGovernanceAgentStopsByIdRetryResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceAgentStopsByIdRetryResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceAgentStopsByIdRetryResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiGovernanceAgentStopsByIdRetryResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostApiGovernanceAgentStopsByIdRetryResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = PostApiGovernanceAgentStopsByIdRetryResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceAgentStopsByIdRetryResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceAgentStopsByIdRetryResponse202
    | PostApiGovernanceAgentStopsByIdRetryResponse400
    | PostApiGovernanceAgentStopsByIdRetryResponse401
    | PostApiGovernanceAgentStopsByIdRetryResponse403
    | PostApiGovernanceAgentStopsByIdRetryResponse404
    | PostApiGovernanceAgentStopsByIdRetryResponse409
    | PostApiGovernanceAgentStopsByIdRetryResponse422
    | PostApiGovernanceAgentStopsByIdRetryResponse500
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
    PostApiGovernanceAgentStopsByIdRetryResponse202
    | PostApiGovernanceAgentStopsByIdRetryResponse400
    | PostApiGovernanceAgentStopsByIdRetryResponse401
    | PostApiGovernanceAgentStopsByIdRetryResponse403
    | PostApiGovernanceAgentStopsByIdRetryResponse404
    | PostApiGovernanceAgentStopsByIdRetryResponse409
    | PostApiGovernanceAgentStopsByIdRetryResponse422
    | PostApiGovernanceAgentStopsByIdRetryResponse500
]:
    """Retry a stop

     Applies the stop again to every target it has not stopped: the ones that failed, the ones a restore
    turned back on, and plan targets added since the stop was requested. Targets already stopped are
    left alone. Only a `quarantined`, `stop_failed` or `restore_failed` stop can be retried (409
    `agent_stop_not_retryable`). The stop goes back to `stopping` and announces its new outcome.

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdRetryResponse202 | PostApiGovernanceAgentStopsByIdRetryResponse400 | PostApiGovernanceAgentStopsByIdRetryResponse401 | PostApiGovernanceAgentStopsByIdRetryResponse403 | PostApiGovernanceAgentStopsByIdRetryResponse404 | PostApiGovernanceAgentStopsByIdRetryResponse409 | PostApiGovernanceAgentStopsByIdRetryResponse422 | PostApiGovernanceAgentStopsByIdRetryResponse500]
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
    PostApiGovernanceAgentStopsByIdRetryResponse202
    | PostApiGovernanceAgentStopsByIdRetryResponse400
    | PostApiGovernanceAgentStopsByIdRetryResponse401
    | PostApiGovernanceAgentStopsByIdRetryResponse403
    | PostApiGovernanceAgentStopsByIdRetryResponse404
    | PostApiGovernanceAgentStopsByIdRetryResponse409
    | PostApiGovernanceAgentStopsByIdRetryResponse422
    | PostApiGovernanceAgentStopsByIdRetryResponse500
    | None
):
    """Retry a stop

     Applies the stop again to every target it has not stopped: the ones that failed, the ones a restore
    turned back on, and plan targets added since the stop was requested. Targets already stopped are
    left alone. Only a `quarantined`, `stop_failed` or `restore_failed` stop can be retried (409
    `agent_stop_not_retryable`). The stop goes back to `stopping` and announces its new outcome.

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdRetryResponse202 | PostApiGovernanceAgentStopsByIdRetryResponse400 | PostApiGovernanceAgentStopsByIdRetryResponse401 | PostApiGovernanceAgentStopsByIdRetryResponse403 | PostApiGovernanceAgentStopsByIdRetryResponse404 | PostApiGovernanceAgentStopsByIdRetryResponse409 | PostApiGovernanceAgentStopsByIdRetryResponse422 | PostApiGovernanceAgentStopsByIdRetryResponse500
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
    PostApiGovernanceAgentStopsByIdRetryResponse202
    | PostApiGovernanceAgentStopsByIdRetryResponse400
    | PostApiGovernanceAgentStopsByIdRetryResponse401
    | PostApiGovernanceAgentStopsByIdRetryResponse403
    | PostApiGovernanceAgentStopsByIdRetryResponse404
    | PostApiGovernanceAgentStopsByIdRetryResponse409
    | PostApiGovernanceAgentStopsByIdRetryResponse422
    | PostApiGovernanceAgentStopsByIdRetryResponse500
]:
    """Retry a stop

     Applies the stop again to every target it has not stopped: the ones that failed, the ones a restore
    turned back on, and plan targets added since the stop was requested. Targets already stopped are
    left alone. Only a `quarantined`, `stop_failed` or `restore_failed` stop can be retried (409
    `agent_stop_not_retryable`). The stop goes back to `stopping` and announces its new outcome.

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceAgentStopsByIdRetryResponse202 | PostApiGovernanceAgentStopsByIdRetryResponse400 | PostApiGovernanceAgentStopsByIdRetryResponse401 | PostApiGovernanceAgentStopsByIdRetryResponse403 | PostApiGovernanceAgentStopsByIdRetryResponse404 | PostApiGovernanceAgentStopsByIdRetryResponse409 | PostApiGovernanceAgentStopsByIdRetryResponse422 | PostApiGovernanceAgentStopsByIdRetryResponse500]
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
    PostApiGovernanceAgentStopsByIdRetryResponse202
    | PostApiGovernanceAgentStopsByIdRetryResponse400
    | PostApiGovernanceAgentStopsByIdRetryResponse401
    | PostApiGovernanceAgentStopsByIdRetryResponse403
    | PostApiGovernanceAgentStopsByIdRetryResponse404
    | PostApiGovernanceAgentStopsByIdRetryResponse409
    | PostApiGovernanceAgentStopsByIdRetryResponse422
    | PostApiGovernanceAgentStopsByIdRetryResponse500
    | None
):
    """Retry a stop

     Applies the stop again to every target it has not stopped: the ones that failed, the ones a restore
    turned back on, and plan targets added since the stop was requested. Targets already stopped are
    left alone. Only a `quarantined`, `stop_failed` or `restore_failed` stop can be retried (409
    `agent_stop_not_retryable`). The stop goes back to `stopping` and announces its new outcome.

    Args:
        stop_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceAgentStopsByIdRetryResponse202 | PostApiGovernanceAgentStopsByIdRetryResponse400 | PostApiGovernanceAgentStopsByIdRetryResponse401 | PostApiGovernanceAgentStopsByIdRetryResponse403 | PostApiGovernanceAgentStopsByIdRetryResponse404 | PostApiGovernanceAgentStopsByIdRetryResponse409 | PostApiGovernanceAgentStopsByIdRetryResponse422 | PostApiGovernanceAgentStopsByIdRetryResponse500
    """

    return (
        await asyncio_detailed(
            stop_id=stop_id,
            client=client,
        )
    ).parsed
