from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_agent_cache_by_name_claim_body import PostApiAgentCacheByNameClaimBody
from ...models.post_api_agent_cache_by_name_claim_response_200 import PostApiAgentCacheByNameClaimResponse200
from ...models.post_api_agent_cache_by_name_claim_response_400 import PostApiAgentCacheByNameClaimResponse400
from ...models.post_api_agent_cache_by_name_claim_response_401 import PostApiAgentCacheByNameClaimResponse401
from ...models.post_api_agent_cache_by_name_claim_response_403 import PostApiAgentCacheByNameClaimResponse403
from ...models.post_api_agent_cache_by_name_claim_response_500 import PostApiAgentCacheByNameClaimResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    name: str,
    *,
    body: PostApiAgentCacheByNameClaimBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/agent-cache/{name}/claim".format(
            name=quote(str(name), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiAgentCacheByNameClaimResponse200
    | PostApiAgentCacheByNameClaimResponse400
    | PostApiAgentCacheByNameClaimResponse401
    | PostApiAgentCacheByNameClaimResponse403
    | PostApiAgentCacheByNameClaimResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiAgentCacheByNameClaimResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiAgentCacheByNameClaimResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiAgentCacheByNameClaimResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiAgentCacheByNameClaimResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiAgentCacheByNameClaimResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiAgentCacheByNameClaimResponse200
    | PostApiAgentCacheByNameClaimResponse400
    | PostApiAgentCacheByNameClaimResponse401
    | PostApiAgentCacheByNameClaimResponse403
    | PostApiAgentCacheByNameClaimResponse500
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
    name: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentCacheByNameClaimBody,
) -> Response[
    PostApiAgentCacheByNameClaimResponse200
    | PostApiAgentCacheByNameClaimResponse400
    | PostApiAgentCacheByNameClaimResponse401
    | PostApiAgentCacheByNameClaimResponse403
    | PostApiAgentCacheByNameClaimResponse500
]:
    """Store a value under a name only if the project does not hold that name yet. The answer says whether
    this caller is the one that took it: `claimed` is true when the value was written, and false when
    the name was already held, which leaves the held value alone. Losing is an ordinary answer and not a
    refusal, so a caller branches on `claimed` rather than on an error. This is what one row of a run
    uses to do work the rows beside it then reuse, instead of every row doing it at once. The value is
    encrypted at rest and expires by itself after ttl_seconds, which defaults to 900 seconds.

    Args:
        name (str):
        body (PostApiAgentCacheByNameClaimBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiAgentCacheByNameClaimResponse200 | PostApiAgentCacheByNameClaimResponse400 | PostApiAgentCacheByNameClaimResponse401 | PostApiAgentCacheByNameClaimResponse403 | PostApiAgentCacheByNameClaimResponse500]
    """

    kwargs = _get_kwargs(
        name=name,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    name: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentCacheByNameClaimBody,
) -> (
    PostApiAgentCacheByNameClaimResponse200
    | PostApiAgentCacheByNameClaimResponse400
    | PostApiAgentCacheByNameClaimResponse401
    | PostApiAgentCacheByNameClaimResponse403
    | PostApiAgentCacheByNameClaimResponse500
    | None
):
    """Store a value under a name only if the project does not hold that name yet. The answer says whether
    this caller is the one that took it: `claimed` is true when the value was written, and false when
    the name was already held, which leaves the held value alone. Losing is an ordinary answer and not a
    refusal, so a caller branches on `claimed` rather than on an error. This is what one row of a run
    uses to do work the rows beside it then reuse, instead of every row doing it at once. The value is
    encrypted at rest and expires by itself after ttl_seconds, which defaults to 900 seconds.

    Args:
        name (str):
        body (PostApiAgentCacheByNameClaimBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiAgentCacheByNameClaimResponse200 | PostApiAgentCacheByNameClaimResponse400 | PostApiAgentCacheByNameClaimResponse401 | PostApiAgentCacheByNameClaimResponse403 | PostApiAgentCacheByNameClaimResponse500
    """

    return sync_detailed(
        name=name,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    name: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentCacheByNameClaimBody,
) -> Response[
    PostApiAgentCacheByNameClaimResponse200
    | PostApiAgentCacheByNameClaimResponse400
    | PostApiAgentCacheByNameClaimResponse401
    | PostApiAgentCacheByNameClaimResponse403
    | PostApiAgentCacheByNameClaimResponse500
]:
    """Store a value under a name only if the project does not hold that name yet. The answer says whether
    this caller is the one that took it: `claimed` is true when the value was written, and false when
    the name was already held, which leaves the held value alone. Losing is an ordinary answer and not a
    refusal, so a caller branches on `claimed` rather than on an error. This is what one row of a run
    uses to do work the rows beside it then reuse, instead of every row doing it at once. The value is
    encrypted at rest and expires by itself after ttl_seconds, which defaults to 900 seconds.

    Args:
        name (str):
        body (PostApiAgentCacheByNameClaimBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiAgentCacheByNameClaimResponse200 | PostApiAgentCacheByNameClaimResponse400 | PostApiAgentCacheByNameClaimResponse401 | PostApiAgentCacheByNameClaimResponse403 | PostApiAgentCacheByNameClaimResponse500]
    """

    kwargs = _get_kwargs(
        name=name,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    name: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentCacheByNameClaimBody,
) -> (
    PostApiAgentCacheByNameClaimResponse200
    | PostApiAgentCacheByNameClaimResponse400
    | PostApiAgentCacheByNameClaimResponse401
    | PostApiAgentCacheByNameClaimResponse403
    | PostApiAgentCacheByNameClaimResponse500
    | None
):
    """Store a value under a name only if the project does not hold that name yet. The answer says whether
    this caller is the one that took it: `claimed` is true when the value was written, and false when
    the name was already held, which leaves the held value alone. Losing is an ordinary answer and not a
    refusal, so a caller branches on `claimed` rather than on an error. This is what one row of a run
    uses to do work the rows beside it then reuse, instead of every row doing it at once. The value is
    encrypted at rest and expires by itself after ttl_seconds, which defaults to 900 seconds.

    Args:
        name (str):
        body (PostApiAgentCacheByNameClaimBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiAgentCacheByNameClaimResponse200 | PostApiAgentCacheByNameClaimResponse400 | PostApiAgentCacheByNameClaimResponse401 | PostApiAgentCacheByNameClaimResponse403 | PostApiAgentCacheByNameClaimResponse500
    """

    return (
        await asyncio_detailed(
            name=name,
            client=client,
            body=body,
        )
    ).parsed
