from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_query_body import PostApiV1QueryBody
from ...models.post_api_v1_query_response_200 import PostApiV1QueryResponse200
from ...models.post_api_v1_query_response_400 import PostApiV1QueryResponse400
from ...models.post_api_v1_query_response_401 import PostApiV1QueryResponse401
from ...models.post_api_v1_query_response_403 import PostApiV1QueryResponse403
from ...models.post_api_v1_query_response_404 import PostApiV1QueryResponse404
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
    | PostApiV1QueryResponse404
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

    if response.status_code == 404:
        response_404 = PostApiV1QueryResponse404.from_dict(response.json())

        return response_404

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
    | PostApiV1QueryResponse404
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
    | PostApiV1QueryResponse404
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
]:
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics views and returns typed columns, rows,
    execution statistics and diagnostics. The query runs as a restricted database identity scoped to the
    projects this key can read.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    A projection may call the app functions the schema endpoint lists (`conversation`,
    `llm_readable_trace`, `llm_messages`, and so on). Those are computed by the application after the
    query, so they are allowed only as aliased entries in the top-level SELECT list; a call in WHERE,
    GROUP BY, ORDER BY, a join, a subquery or a nested expression is refused, and a UNION disqualifies
    both of its branches even where each reads as a top-level projection. A projection may also call the
    eval functions, which judge a text with a model and are charged for; their key is the text itself. A
    run that would need more distinct conversations, traces, spans or texts than the published cap
    answers 422 rather than a partial result, and a run whose texts would exceed the per-query token
    budget answers 422 before anything is sent.

    A project API key reads its own project. A key for an organization, a team or a person must name the
    projects to read in `projects`, each one it can read `analytics:view` on; without them the run is
    refused with `projects_required` (422). Rows from more than one project come back flagged with the
    `MULTI_PROJECT_RESULT` diagnostic.

    Send `projects`, a list of project ids, to name the projects to read; `projectId` (one id) still
    works, and sending both is a 422. A project the key cannot read `analytics:view` on, a project of
    another organization and a project that does not exist are all refused with `project_not_found`
    (404), with one body that names no id. Send `sources` to bind
    `{dashboard_context_sources:Array(String)}` (application when absent); only a statement that reads
    that placeholder is kept to those origins. `{dashboard_context_projects:Array(String)}` is bound to
    the projects read. The answer's `params` lists every placeholder the statement declares by its SQL
    name with the value it ran with, plus the `period` it followed. A `SOURCES_IGNORED` diagnostic says
    `sources` changed nothing; `GRANULARITY_COARSENED` says the step ran coarser than asked.

    A statement that names no `LIMIT` is capped at 10,000 rows: that `LIMIT` is appended before the
    query runs. A statement whose own `LIMIT` asks for more is refused with `LIMIT_TOO_HIGH` — lower it
    and page the rest with `LIMIT`/`OFFSET` and an `ORDER BY`. When using `UNION`, every top-level
    branch must carry its own `LIMIT` clause of 10,000 rows or fewer, or the query is refused with
    `LIMIT_REQUIRED_PER_BRANCH`. A result whose body exceeds about 8,000,000 bytes is refused outright
    with `lwql_result_too_large`, never cut — select fewer columns or a smaller `LIMIT`.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse404 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500]
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
    | PostApiV1QueryResponse404
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
    | None
):
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics views and returns typed columns, rows,
    execution statistics and diagnostics. The query runs as a restricted database identity scoped to the
    projects this key can read.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    A projection may call the app functions the schema endpoint lists (`conversation`,
    `llm_readable_trace`, `llm_messages`, and so on). Those are computed by the application after the
    query, so they are allowed only as aliased entries in the top-level SELECT list; a call in WHERE,
    GROUP BY, ORDER BY, a join, a subquery or a nested expression is refused, and a UNION disqualifies
    both of its branches even where each reads as a top-level projection. A projection may also call the
    eval functions, which judge a text with a model and are charged for; their key is the text itself. A
    run that would need more distinct conversations, traces, spans or texts than the published cap
    answers 422 rather than a partial result, and a run whose texts would exceed the per-query token
    budget answers 422 before anything is sent.

    A project API key reads its own project. A key for an organization, a team or a person must name the
    projects to read in `projects`, each one it can read `analytics:view` on; without them the run is
    refused with `projects_required` (422). Rows from more than one project come back flagged with the
    `MULTI_PROJECT_RESULT` diagnostic.

    Send `projects`, a list of project ids, to name the projects to read; `projectId` (one id) still
    works, and sending both is a 422. A project the key cannot read `analytics:view` on, a project of
    another organization and a project that does not exist are all refused with `project_not_found`
    (404), with one body that names no id. Send `sources` to bind
    `{dashboard_context_sources:Array(String)}` (application when absent); only a statement that reads
    that placeholder is kept to those origins. `{dashboard_context_projects:Array(String)}` is bound to
    the projects read. The answer's `params` lists every placeholder the statement declares by its SQL
    name with the value it ran with, plus the `period` it followed. A `SOURCES_IGNORED` diagnostic says
    `sources` changed nothing; `GRANULARITY_COARSENED` says the step ran coarser than asked.

    A statement that names no `LIMIT` is capped at 10,000 rows: that `LIMIT` is appended before the
    query runs. A statement whose own `LIMIT` asks for more is refused with `LIMIT_TOO_HIGH` — lower it
    and page the rest with `LIMIT`/`OFFSET` and an `ORDER BY`. When using `UNION`, every top-level
    branch must carry its own `LIMIT` clause of 10,000 rows or fewer, or the query is refused with
    `LIMIT_REQUIRED_PER_BRANCH`. A result whose body exceeds about 8,000,000 bytes is refused outright
    with `lwql_result_too_large`, never cut — select fewer columns or a smaller `LIMIT`.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse404 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500
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
    | PostApiV1QueryResponse404
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
]:
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics views and returns typed columns, rows,
    execution statistics and diagnostics. The query runs as a restricted database identity scoped to the
    projects this key can read.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    A projection may call the app functions the schema endpoint lists (`conversation`,
    `llm_readable_trace`, `llm_messages`, and so on). Those are computed by the application after the
    query, so they are allowed only as aliased entries in the top-level SELECT list; a call in WHERE,
    GROUP BY, ORDER BY, a join, a subquery or a nested expression is refused, and a UNION disqualifies
    both of its branches even where each reads as a top-level projection. A projection may also call the
    eval functions, which judge a text with a model and are charged for; their key is the text itself. A
    run that would need more distinct conversations, traces, spans or texts than the published cap
    answers 422 rather than a partial result, and a run whose texts would exceed the per-query token
    budget answers 422 before anything is sent.

    A project API key reads its own project. A key for an organization, a team or a person must name the
    projects to read in `projects`, each one it can read `analytics:view` on; without them the run is
    refused with `projects_required` (422). Rows from more than one project come back flagged with the
    `MULTI_PROJECT_RESULT` diagnostic.

    Send `projects`, a list of project ids, to name the projects to read; `projectId` (one id) still
    works, and sending both is a 422. A project the key cannot read `analytics:view` on, a project of
    another organization and a project that does not exist are all refused with `project_not_found`
    (404), with one body that names no id. Send `sources` to bind
    `{dashboard_context_sources:Array(String)}` (application when absent); only a statement that reads
    that placeholder is kept to those origins. `{dashboard_context_projects:Array(String)}` is bound to
    the projects read. The answer's `params` lists every placeholder the statement declares by its SQL
    name with the value it ran with, plus the `period` it followed. A `SOURCES_IGNORED` diagnostic says
    `sources` changed nothing; `GRANULARITY_COARSENED` says the step ran coarser than asked.

    A statement that names no `LIMIT` is capped at 10,000 rows: that `LIMIT` is appended before the
    query runs. A statement whose own `LIMIT` asks for more is refused with `LIMIT_TOO_HIGH` — lower it
    and page the rest with `LIMIT`/`OFFSET` and an `ORDER BY`. When using `UNION`, every top-level
    branch must carry its own `LIMIT` clause of 10,000 rows or fewer, or the query is refused with
    `LIMIT_REQUIRED_PER_BRANCH`. A result whose body exceeds about 8,000,000 bytes is refused outright
    with `lwql_result_too_large`, never cut — select fewer columns or a smaller `LIMIT`.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse404 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500]
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
    | PostApiV1QueryResponse404
    | PostApiV1QueryResponse422
    | PostApiV1QueryResponse500
    | None
):
    """Run a LangWatchQL query

     Executes one read-only LangWatchQL SELECT over the analytics views and returns typed columns, rows,
    execution statistics and diagnostics. The query runs as a restricted database identity scoped to the
    projects this key can read.

    Diagnostics are advisory and never reject a query. An empty diagnostics list means no known issue
    was detected. It is not proof that the answer is the one you meant.

    A projection may call the app functions the schema endpoint lists (`conversation`,
    `llm_readable_trace`, `llm_messages`, and so on). Those are computed by the application after the
    query, so they are allowed only as aliased entries in the top-level SELECT list; a call in WHERE,
    GROUP BY, ORDER BY, a join, a subquery or a nested expression is refused, and a UNION disqualifies
    both of its branches even where each reads as a top-level projection. A projection may also call the
    eval functions, which judge a text with a model and are charged for; their key is the text itself. A
    run that would need more distinct conversations, traces, spans or texts than the published cap
    answers 422 rather than a partial result, and a run whose texts would exceed the per-query token
    budget answers 422 before anything is sent.

    A project API key reads its own project. A key for an organization, a team or a person must name the
    projects to read in `projects`, each one it can read `analytics:view` on; without them the run is
    refused with `projects_required` (422). Rows from more than one project come back flagged with the
    `MULTI_PROJECT_RESULT` diagnostic.

    Send `projects`, a list of project ids, to name the projects to read; `projectId` (one id) still
    works, and sending both is a 422. A project the key cannot read `analytics:view` on, a project of
    another organization and a project that does not exist are all refused with `project_not_found`
    (404), with one body that names no id. Send `sources` to bind
    `{dashboard_context_sources:Array(String)}` (application when absent); only a statement that reads
    that placeholder is kept to those origins. `{dashboard_context_projects:Array(String)}` is bound to
    the projects read. The answer's `params` lists every placeholder the statement declares by its SQL
    name with the value it ran with, plus the `period` it followed. A `SOURCES_IGNORED` diagnostic says
    `sources` changed nothing; `GRANULARITY_COARSENED` says the step ran coarser than asked.

    A statement that names no `LIMIT` is capped at 10,000 rows: that `LIMIT` is appended before the
    query runs. A statement whose own `LIMIT` asks for more is refused with `LIMIT_TOO_HIGH` — lower it
    and page the rest with `LIMIT`/`OFFSET` and an `ORDER BY`. When using `UNION`, every top-level
    branch must carry its own `LIMIT` clause of 10,000 rows or fewer, or the query is refused with
    `LIMIT_REQUIRED_PER_BRANCH`. A result whose body exceeds about 8,000,000 bytes is refused outright
    with `lwql_result_too_large`, never cut — select fewer columns or a smaller `LIMIT`.

    Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's
    canonical error envelope — the same `code` and `meta` every other REST family publishes.

    Args:
        body (PostApiV1QueryBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1QueryResponse200 | PostApiV1QueryResponse400 | PostApiV1QueryResponse401 | PostApiV1QueryResponse403 | PostApiV1QueryResponse404 | PostApiV1QueryResponse422 | PostApiV1QueryResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
