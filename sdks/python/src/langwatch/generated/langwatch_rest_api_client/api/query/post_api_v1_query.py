from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_query_body import PostApiV1QueryBody
from ...models.post_api_v1_query_response_200 import PostApiV1QueryResponse200
from ...models.post_api_v1_query_response_400 import PostApiV1QueryResponse400
from ...models.post_api_v1_query_response_401 import PostApiV1QueryResponse401
from ...models.post_api_v1_query_response_403 import PostApiV1QueryResponse403
from ...models.post_api_v1_query_response_422 import PostApiV1QueryResponse422
from ...models.post_api_v1_query_response_500 import PostApiV1QueryResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiV1QueryBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/query",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1QueryResponse200
    | PostApiV1QueryResponse400
    | PostApiV1QueryResponse401
    | PostApiV1QueryResponse403
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1QueryResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiV1QueryResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1QueryResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiV1QueryResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = PostApiV1QueryResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiV1QueryResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1QueryResponse200
    | PostApiV1QueryResponse400
    | PostApiV1QueryResponse401
    | PostApiV1QueryResponse403
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
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
    body: PostApiV1QueryBody,
) -> Response[
    PostApiV1QueryResponse200
    | PostApiV1QueryResponse400
    | PostApiV1QueryResponse401
    | PostApiV1QueryResponse403
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
]:
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns,
    rows, execution statistics, truncation state and diagnostics. The query runs as a restricted
    database identity scoped to the authenticated project.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    The project is taken from the credential — no project id appears anywhere in the path or the body,
    and none can be sent to select another one.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500]
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
    body: PostApiV1QueryBody,
) -> (
    PostApiV1QueryResponse200
    | PostApiV1QueryResponse400
    | PostApiV1QueryResponse401
    | PostApiV1QueryResponse403
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
    | None
):
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns,
    rows, execution statistics, truncation state and diagnostics. The query runs as a restricted
    database identity scoped to the authenticated project.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    The project is taken from the credential — no project id appears anywhere in the path or the body,
    and none can be sent to select another one.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1QueryBody,
) -> Response[
    PostApiV1QueryResponse200
    | PostApiV1QueryResponse400
    | PostApiV1QueryResponse401
    | PostApiV1QueryResponse403
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
]:
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns,
    rows, execution statistics, truncation state and diagnostics. The query runs as a restricted
    database identity scoped to the authenticated project.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    The project is taken from the credential — no project id appears anywhere in the path or the body,
    and none can be sent to select another one.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiV1QueryBody,
) -> (
    PostApiV1QueryResponse200
    | PostApiV1QueryResponse400
    | PostApiV1QueryResponse401
    | PostApiV1QueryResponse403
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
    | None
):
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns,
    rows, execution statistics, truncation state and diagnostics. The query runs as a restricted
    database identity scoped to the authenticated project.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    The project is taken from the credential — no project id appears anywhere in the path or the body,
    and none can be sent to select another one.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
