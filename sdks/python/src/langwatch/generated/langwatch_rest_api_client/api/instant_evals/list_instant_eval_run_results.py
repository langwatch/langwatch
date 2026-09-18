from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_instant_eval_run_results_matched import ListInstantEvalRunResultsMatched
from ...models.list_instant_eval_run_results_response_200 import ListInstantEvalRunResultsResponse200
from ...models.list_instant_eval_run_results_status import ListInstantEvalRunResultsStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    question_id: str | Unset = UNSET,
    matched: ListInstantEvalRunResultsMatched | Unset = UNSET,
    status: ListInstantEvalRunResultsStatus | Unset = UNSET,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["questionId"] = question_id

    json_matched: str | Unset = UNSET
    if not isinstance(matched, Unset):
        json_matched = matched.value

    params["matched"] = json_matched

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/instant-evals/{id}/results".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListInstantEvalRunResultsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListInstantEvalRunResultsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListInstantEvalRunResultsResponse200]:
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
    id: str,
    *,
    client: AuthenticatedClient,
    question_id: str | Unset = UNSET,
    matched: ListInstantEvalRunResultsMatched | Unset = UNSET,
    status: ListInstantEvalRunResultsStatus | Unset = UNSET,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> Response[ListInstantEvalRunResultsResponse200]:
    """Read a run's results

     Read the run's judgements, one page at a time. Pass the cursor a page answers with to read the page
    after it; the last page carries no cursor, and no judgement is ever carried by two pages. Narrow the
    page with questionId, matched and status.

    Args:
        id (str):
        question_id (str | Unset):
        matched (ListInstantEvalRunResultsMatched | Unset):
        status (ListInstantEvalRunResultsStatus | Unset):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListInstantEvalRunResultsResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        question_id=question_id,
        matched=matched,
        status=status,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    question_id: str | Unset = UNSET,
    matched: ListInstantEvalRunResultsMatched | Unset = UNSET,
    status: ListInstantEvalRunResultsStatus | Unset = UNSET,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> ListInstantEvalRunResultsResponse200 | None:
    """Read a run's results

     Read the run's judgements, one page at a time. Pass the cursor a page answers with to read the page
    after it; the last page carries no cursor, and no judgement is ever carried by two pages. Narrow the
    page with questionId, matched and status.

    Args:
        id (str):
        question_id (str | Unset):
        matched (ListInstantEvalRunResultsMatched | Unset):
        status (ListInstantEvalRunResultsStatus | Unset):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListInstantEvalRunResultsResponse200
    """

    return sync_detailed(
        id=id,
        client=client,
        question_id=question_id,
        matched=matched,
        status=status,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    question_id: str | Unset = UNSET,
    matched: ListInstantEvalRunResultsMatched | Unset = UNSET,
    status: ListInstantEvalRunResultsStatus | Unset = UNSET,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> Response[ListInstantEvalRunResultsResponse200]:
    """Read a run's results

     Read the run's judgements, one page at a time. Pass the cursor a page answers with to read the page
    after it; the last page carries no cursor, and no judgement is ever carried by two pages. Narrow the
    page with questionId, matched and status.

    Args:
        id (str):
        question_id (str | Unset):
        matched (ListInstantEvalRunResultsMatched | Unset):
        status (ListInstantEvalRunResultsStatus | Unset):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListInstantEvalRunResultsResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        question_id=question_id,
        matched=matched,
        status=status,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    question_id: str | Unset = UNSET,
    matched: ListInstantEvalRunResultsMatched | Unset = UNSET,
    status: ListInstantEvalRunResultsStatus | Unset = UNSET,
    limit: int | Unset = 100,
    cursor: str | Unset = UNSET,
) -> ListInstantEvalRunResultsResponse200 | None:
    """Read a run's results

     Read the run's judgements, one page at a time. Pass the cursor a page answers with to read the page
    after it; the last page carries no cursor, and no judgement is ever carried by two pages. Narrow the
    page with questionId, matched and status.

    Args:
        id (str):
        question_id (str | Unset):
        matched (ListInstantEvalRunResultsMatched | Unset):
        status (ListInstantEvalRunResultsStatus | Unset):
        limit (int | Unset):  Default: 100.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListInstantEvalRunResultsResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            question_id=question_id,
            matched=matched,
            status=status,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
