from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_coding_agent_pull_request_usage_response_200 import GetApiCodingAgentPullRequestUsageResponse200
from ...models.get_api_coding_agent_pull_request_usage_response_400 import GetApiCodingAgentPullRequestUsageResponse400
from ...models.get_api_coding_agent_pull_request_usage_response_401 import GetApiCodingAgentPullRequestUsageResponse401
from ...models.get_api_coding_agent_pull_request_usage_response_422 import GetApiCodingAgentPullRequestUsageResponse422
from ...models.get_api_coding_agent_pull_request_usage_response_500 import GetApiCodingAgentPullRequestUsageResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    repository: str,
    pull_request: int,
    host: str | Unset = "github.com",
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["repository"] = repository

    params["pullRequest"] = pull_request

    params["host"] = host

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/coding-agent/pull-request-usage",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiCodingAgentPullRequestUsageResponse200
    | GetApiCodingAgentPullRequestUsageResponse400
    | GetApiCodingAgentPullRequestUsageResponse401
    | GetApiCodingAgentPullRequestUsageResponse422
    | GetApiCodingAgentPullRequestUsageResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiCodingAgentPullRequestUsageResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiCodingAgentPullRequestUsageResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiCodingAgentPullRequestUsageResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiCodingAgentPullRequestUsageResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiCodingAgentPullRequestUsageResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiCodingAgentPullRequestUsageResponse200
    | GetApiCodingAgentPullRequestUsageResponse400
    | GetApiCodingAgentPullRequestUsageResponse401
    | GetApiCodingAgentPullRequestUsageResponse422
    | GetApiCodingAgentPullRequestUsageResponse500
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
    *,
    client: AuthenticatedClient,
    repository: str,
    pull_request: int,
    host: str | Unset = "github.com",
) -> Response[
    GetApiCodingAgentPullRequestUsageResponse200
    | GetApiCodingAgentPullRequestUsageResponse400
    | GetApiCodingAgentPullRequestUsageResponse401
    | GetApiCodingAgentPullRequestUsageResponse422
    | GetApiCodingAgentPullRequestUsageResponse500
]:
    """Get pull request coding agent usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Requires a personal-project API key; rows appear only for
    projects the calling user may view, and cost only for those they may price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiCodingAgentPullRequestUsageResponse200 | GetApiCodingAgentPullRequestUsageResponse400 | GetApiCodingAgentPullRequestUsageResponse401 | GetApiCodingAgentPullRequestUsageResponse422 | GetApiCodingAgentPullRequestUsageResponse500]
    """

    kwargs = _get_kwargs(
        repository=repository,
        pull_request=pull_request,
        host=host,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    repository: str,
    pull_request: int,
    host: str | Unset = "github.com",
) -> (
    GetApiCodingAgentPullRequestUsageResponse200
    | GetApiCodingAgentPullRequestUsageResponse400
    | GetApiCodingAgentPullRequestUsageResponse401
    | GetApiCodingAgentPullRequestUsageResponse422
    | GetApiCodingAgentPullRequestUsageResponse500
    | None
):
    """Get pull request coding agent usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Requires a personal-project API key; rows appear only for
    projects the calling user may view, and cost only for those they may price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiCodingAgentPullRequestUsageResponse200 | GetApiCodingAgentPullRequestUsageResponse400 | GetApiCodingAgentPullRequestUsageResponse401 | GetApiCodingAgentPullRequestUsageResponse422 | GetApiCodingAgentPullRequestUsageResponse500
    """

    return sync_detailed(
        client=client,
        repository=repository,
        pull_request=pull_request,
        host=host,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    repository: str,
    pull_request: int,
    host: str | Unset = "github.com",
) -> Response[
    GetApiCodingAgentPullRequestUsageResponse200
    | GetApiCodingAgentPullRequestUsageResponse400
    | GetApiCodingAgentPullRequestUsageResponse401
    | GetApiCodingAgentPullRequestUsageResponse422
    | GetApiCodingAgentPullRequestUsageResponse500
]:
    """Get pull request coding agent usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Requires a personal-project API key; rows appear only for
    projects the calling user may view, and cost only for those they may price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiCodingAgentPullRequestUsageResponse200 | GetApiCodingAgentPullRequestUsageResponse400 | GetApiCodingAgentPullRequestUsageResponse401 | GetApiCodingAgentPullRequestUsageResponse422 | GetApiCodingAgentPullRequestUsageResponse500]
    """

    kwargs = _get_kwargs(
        repository=repository,
        pull_request=pull_request,
        host=host,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    repository: str,
    pull_request: int,
    host: str | Unset = "github.com",
) -> (
    GetApiCodingAgentPullRequestUsageResponse200
    | GetApiCodingAgentPullRequestUsageResponse400
    | GetApiCodingAgentPullRequestUsageResponse401
    | GetApiCodingAgentPullRequestUsageResponse422
    | GetApiCodingAgentPullRequestUsageResponse500
    | None
):
    """Get pull request coding agent usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Requires a personal-project API key; rows appear only for
    projects the calling user may view, and cost only for those they may price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiCodingAgentPullRequestUsageResponse200 | GetApiCodingAgentPullRequestUsageResponse400 | GetApiCodingAgentPullRequestUsageResponse401 | GetApiCodingAgentPullRequestUsageResponse422 | GetApiCodingAgentPullRequestUsageResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            repository=repository,
            pull_request=pull_request,
            host=host,
        )
    ).parsed
