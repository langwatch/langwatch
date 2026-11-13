from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_registry_ard_search_body import PostApiGovernanceRegistryArdSearchBody
from ...models.post_api_governance_registry_ard_search_response_200 import PostApiGovernanceRegistryArdSearchResponse200
from ...models.post_api_governance_registry_ard_search_response_400 import PostApiGovernanceRegistryArdSearchResponse400
from ...models.post_api_governance_registry_ard_search_response_401 import PostApiGovernanceRegistryArdSearchResponse401
from ...models.post_api_governance_registry_ard_search_response_422 import PostApiGovernanceRegistryArdSearchResponse422
from ...models.post_api_governance_registry_ard_search_response_500 import PostApiGovernanceRegistryArdSearchResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiGovernanceRegistryArdSearchBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/registry/ard/search",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceRegistryArdSearchResponse200
    | PostApiGovernanceRegistryArdSearchResponse400
    | PostApiGovernanceRegistryArdSearchResponse401
    | PostApiGovernanceRegistryArdSearchResponse422
    | PostApiGovernanceRegistryArdSearchResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGovernanceRegistryArdSearchResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGovernanceRegistryArdSearchResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceRegistryArdSearchResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiGovernanceRegistryArdSearchResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceRegistryArdSearchResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceRegistryArdSearchResponse200
    | PostApiGovernanceRegistryArdSearchResponse400
    | PostApiGovernanceRegistryArdSearchResponse401
    | PostApiGovernanceRegistryArdSearchResponse422
    | PostApiGovernanceRegistryArdSearchResponse500
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
    body: PostApiGovernanceRegistryArdSearchBody,
) -> Response[
    PostApiGovernanceRegistryArdSearchResponse200
    | PostApiGovernanceRegistryArdSearchResponse400
    | PostApiGovernanceRegistryArdSearchResponse401
    | PostApiGovernanceRegistryArdSearchResponse422
    | PostApiGovernanceRegistryArdSearchResponse500
]:
    """Search the registry (ARD search)

     ARD `POST /search`: `query.text` is matched against names, capabilities, descriptions, instructions
    and tools; `query.filter` keys are term paths (`tags`, `capabilities`, `data.source`,
    `data.shadow`), values within a key are OR-ed and keys AND-ed. Results carry a 0 to 100 relevance
    `score`. Federation is not performed.

    Args:
        body (PostApiGovernanceRegistryArdSearchBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceRegistryArdSearchResponse200 | PostApiGovernanceRegistryArdSearchResponse400 | PostApiGovernanceRegistryArdSearchResponse401 | PostApiGovernanceRegistryArdSearchResponse422 | PostApiGovernanceRegistryArdSearchResponse500]
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
    body: PostApiGovernanceRegistryArdSearchBody,
) -> (
    PostApiGovernanceRegistryArdSearchResponse200
    | PostApiGovernanceRegistryArdSearchResponse400
    | PostApiGovernanceRegistryArdSearchResponse401
    | PostApiGovernanceRegistryArdSearchResponse422
    | PostApiGovernanceRegistryArdSearchResponse500
    | None
):
    """Search the registry (ARD search)

     ARD `POST /search`: `query.text` is matched against names, capabilities, descriptions, instructions
    and tools; `query.filter` keys are term paths (`tags`, `capabilities`, `data.source`,
    `data.shadow`), values within a key are OR-ed and keys AND-ed. Results carry a 0 to 100 relevance
    `score`. Federation is not performed.

    Args:
        body (PostApiGovernanceRegistryArdSearchBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceRegistryArdSearchResponse200 | PostApiGovernanceRegistryArdSearchResponse400 | PostApiGovernanceRegistryArdSearchResponse401 | PostApiGovernanceRegistryArdSearchResponse422 | PostApiGovernanceRegistryArdSearchResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceRegistryArdSearchBody,
) -> Response[
    PostApiGovernanceRegistryArdSearchResponse200
    | PostApiGovernanceRegistryArdSearchResponse400
    | PostApiGovernanceRegistryArdSearchResponse401
    | PostApiGovernanceRegistryArdSearchResponse422
    | PostApiGovernanceRegistryArdSearchResponse500
]:
    """Search the registry (ARD search)

     ARD `POST /search`: `query.text` is matched against names, capabilities, descriptions, instructions
    and tools; `query.filter` keys are term paths (`tags`, `capabilities`, `data.source`,
    `data.shadow`), values within a key are OR-ed and keys AND-ed. Results carry a 0 to 100 relevance
    `score`. Federation is not performed.

    Args:
        body (PostApiGovernanceRegistryArdSearchBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceRegistryArdSearchResponse200 | PostApiGovernanceRegistryArdSearchResponse400 | PostApiGovernanceRegistryArdSearchResponse401 | PostApiGovernanceRegistryArdSearchResponse422 | PostApiGovernanceRegistryArdSearchResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceRegistryArdSearchBody,
) -> (
    PostApiGovernanceRegistryArdSearchResponse200
    | PostApiGovernanceRegistryArdSearchResponse400
    | PostApiGovernanceRegistryArdSearchResponse401
    | PostApiGovernanceRegistryArdSearchResponse422
    | PostApiGovernanceRegistryArdSearchResponse500
    | None
):
    """Search the registry (ARD search)

     ARD `POST /search`: `query.text` is matched against names, capabilities, descriptions, instructions
    and tools; `query.filter` keys are term paths (`tags`, `capabilities`, `data.source`,
    `data.shadow`), values within a key are OR-ed and keys AND-ed. Results carry a 0 to 100 relevance
    `score`. Federation is not performed.

    Args:
        body (PostApiGovernanceRegistryArdSearchBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceRegistryArdSearchResponse200 | PostApiGovernanceRegistryArdSearchResponse400 | PostApiGovernanceRegistryArdSearchResponse401 | PostApiGovernanceRegistryArdSearchResponse422 | PostApiGovernanceRegistryArdSearchResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
