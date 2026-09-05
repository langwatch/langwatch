from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_pull_request_usage_response_200 import GetPullRequestUsageResponse200
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
        "url": "/api/v1/coding-agent/pull-request-usage",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetPullRequestUsageResponse200 | None:
    if response.status_code == 200:
        response_200 = GetPullRequestUsageResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetPullRequestUsageResponse200]:
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
) -> Response[GetPullRequestUsageResponse200]:
    """Get pull request usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Authenticate with an organization API key and nothing
    else: no project id is sent anywhere. A key created for you reads with your own access; an
    organization service key, such as one a continuous integration job holds, reads with the access its
    bindings grant. Rows appear only for projects the key may view, and cost only for those it may
    price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetPullRequestUsageResponse200]
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
) -> GetPullRequestUsageResponse200 | None:
    """Get pull request usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Authenticate with an organization API key and nothing
    else: no project id is sent anywhere. A key created for you reads with your own access; an
    organization service key, such as one a continuous integration job holds, reads with the access its
    bindings grant. Rows appear only for projects the key may view, and cost only for those it may
    price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetPullRequestUsageResponse200
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
) -> Response[GetPullRequestUsageResponse200]:
    """Get pull request usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Authenticate with an organization API key and nothing
    else: no project id is sent anywhere. A key created for you reads with your own access; an
    organization service key, such as one a continuous integration job holds, reads with the access its
    bindings grant. Rows appear only for projects the key may view, and cost only for those it may
    price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetPullRequestUsageResponse200]
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
) -> GetPullRequestUsageResponse200 | None:
    """Get pull request usage

     Assistant usage for one pull request: sessions, tokens and cost, grouped by contributor and agent,
    plus per-model totals, over the pull request's whole lifetime rather than a time window. Every row
    and the totals split cost three ways: the part priced per token, the part a bundled subscription
    already covers, and the list-price total of both. Per-model totals carry the list price only. Cost
    is calculated from the tokens the agent reported and LangWatch's model prices, so it estimates spend
    rather than restating a provider invoice. Authenticate with an organization API key and nothing
    else: no project id is sent anywhere. A key created for you reads with your own access; an
    organization service key, such as one a continuous integration job holds, reads with the access its
    bindings grant. Rows appear only for projects the key may view, and cost only for those it may
    price.

    Args:
        repository (str):
        pull_request (int):
        host (str | Unset):  Default: 'github.com'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetPullRequestUsageResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            repository=repository,
            pull_request=pull_request,
            host=host,
        )
    ).parsed
