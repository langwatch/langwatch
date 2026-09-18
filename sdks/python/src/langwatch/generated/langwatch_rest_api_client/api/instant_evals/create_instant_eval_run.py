from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_instant_eval_run_body import CreateInstantEvalRunBody
from ...models.create_instant_eval_run_response_202 import CreateInstantEvalRunResponse202
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: CreateInstantEvalRunBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/instant-evals",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CreateInstantEvalRunResponse202 | None:
    if response.status_code == 202:
        response_202 = CreateInstantEvalRunResponse202.from_dict(response.json())

        return response_202

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CreateInstantEvalRunResponse202]:
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
    body: CreateInstantEvalRunBody,
) -> Response[CreateInstantEvalRunResponse202]:
    """Start a run. The statement is accepted, its questions are derived from the eval functions it
    projects, and the judging happens on the queue: the answer is the queued run, and its progress is
    read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId,
    one that projects no eval function, and a row limit past what the plan allows are all refused before
    anything is judged.

    Args:
        body (CreateInstantEvalRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateInstantEvalRunResponse202]
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
    body: CreateInstantEvalRunBody,
) -> CreateInstantEvalRunResponse202 | None:
    """Start a run. The statement is accepted, its questions are derived from the eval functions it
    projects, and the judging happens on the queue: the answer is the queued run, and its progress is
    read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId,
    one that projects no eval function, and a row limit past what the plan allows are all refused before
    anything is judged.

    Args:
        body (CreateInstantEvalRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateInstantEvalRunResponse202
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateInstantEvalRunBody,
) -> Response[CreateInstantEvalRunResponse202]:
    """Start a run. The statement is accepted, its questions are derived from the eval functions it
    projects, and the judging happens on the queue: the answer is the queued run, and its progress is
    read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId,
    one that projects no eval function, and a row limit past what the plan allows are all refused before
    anything is judged.

    Args:
        body (CreateInstantEvalRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateInstantEvalRunResponse202]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateInstantEvalRunBody,
) -> CreateInstantEvalRunResponse202 | None:
    """Start a run. The statement is accepted, its questions are derived from the eval functions it
    projects, and the judging happens on the queue: the answer is the queued run, and its progress is
    read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId,
    one that projects no eval function, and a row limit past what the plan allows are all refused before
    anything is judged.

    Args:
        body (CreateInstantEvalRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateInstantEvalRunResponse202
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
