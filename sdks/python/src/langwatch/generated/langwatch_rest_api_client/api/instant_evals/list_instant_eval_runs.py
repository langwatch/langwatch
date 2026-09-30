import datetime
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.list_instant_eval_runs_response_200 import ListInstantEvalRunsResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    limit: int | Unset = 20,
    before: datetime.datetime | Unset = UNSET,
    before_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    json_before: str | Unset = UNSET
    if not isinstance(before, Unset):
        json_before = before.isoformat()
    params["before"] = json_before

    params["beforeId"] = before_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/instant-evals",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ListInstantEvalRunsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListInstantEvalRunsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ListInstantEvalRunsResponse200]:
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
    limit: int | Unset = 20,
    before: datetime.datetime | Unset = UNSET,
    before_id: str | Unset = UNSET,
) -> Response[ListInstantEvalRunsResponse200]:
    """List the project's runs, newest first. The project comes from the credential, so a run of another
    project is never listed. Page through them with before, which takes the created time of the oldest
    run the previous page carried.

    Args:
        limit (int | Unset):  Default: 20.
        before (datetime.datetime | Unset):
        before_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListInstantEvalRunsResponse200]
    """

    kwargs = _get_kwargs(
        limit=limit,
        before=before,
        before_id=before_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    before: datetime.datetime | Unset = UNSET,
    before_id: str | Unset = UNSET,
) -> ListInstantEvalRunsResponse200 | None:
    """List the project's runs, newest first. The project comes from the credential, so a run of another
    project is never listed. Page through them with before, which takes the created time of the oldest
    run the previous page carried.

    Args:
        limit (int | Unset):  Default: 20.
        before (datetime.datetime | Unset):
        before_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListInstantEvalRunsResponse200
    """

    return sync_detailed(
        client=client,
        limit=limit,
        before=before,
        before_id=before_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    before: datetime.datetime | Unset = UNSET,
    before_id: str | Unset = UNSET,
) -> Response[ListInstantEvalRunsResponse200]:
    """List the project's runs, newest first. The project comes from the credential, so a run of another
    project is never listed. Page through them with before, which takes the created time of the oldest
    run the previous page carried.

    Args:
        limit (int | Unset):  Default: 20.
        before (datetime.datetime | Unset):
        before_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ListInstantEvalRunsResponse200]
    """

    kwargs = _get_kwargs(
        limit=limit,
        before=before,
        before_id=before_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    before: datetime.datetime | Unset = UNSET,
    before_id: str | Unset = UNSET,
) -> ListInstantEvalRunsResponse200 | None:
    """List the project's runs, newest first. The project comes from the credential, so a run of another
    project is never listed. Page through them with before, which takes the created time of the oldest
    run the previous page carried.

    Args:
        limit (int | Unset):  Default: 20.
        before (datetime.datetime | Unset):
        before_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ListInstantEvalRunsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            before=before,
            before_id=before_id,
        )
    ).parsed
