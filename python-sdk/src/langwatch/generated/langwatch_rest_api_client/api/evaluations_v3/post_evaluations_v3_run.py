from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_evaluations_v3_run_response_200 import PostEvaluationsV3RunResponse200
from ...models.post_evaluations_v3_run_response_401 import PostEvaluationsV3RunResponse401
from ...models.post_evaluations_v3_run_response_404 import PostEvaluationsV3RunResponse404
from ...types import Response


def _get_kwargs(
    slug: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/evaluations/v3/{slug}/run".format(
            slug=quote(str(slug), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404 | None:
    if response.status_code == 200:
        response_200 = PostEvaluationsV3RunResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostEvaluationsV3RunResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostEvaluationsV3RunResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404]:
    """Start execution of a saved Evaluations V3 experiment by slug. Returns immediately with a runId for
    polling, or streams SSE events if Accept: text/event-stream header is provided.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404]
    """

    kwargs = _get_kwargs(
        slug=slug,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404 | None:
    """Start execution of a saved Evaluations V3 experiment by slug. Returns immediately with a runId for
    polling, or streams SSE events if Accept: text/event-stream header is provided.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404
    """

    return sync_detailed(
        slug=slug,
        client=client,
    ).parsed


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404]:
    """Start execution of a saved Evaluations V3 experiment by slug. Returns immediately with a runId for
    polling, or streams SSE events if Accept: text/event-stream header is provided.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404]
    """

    kwargs = _get_kwargs(
        slug=slug,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404 | None:
    """Start execution of a saved Evaluations V3 experiment by slug. Returns immediately with a runId for
    polling, or streams SSE events if Accept: text/event-stream header is provided.

    Args:
        slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostEvaluationsV3RunResponse200 | PostEvaluationsV3RunResponse401 | PostEvaluationsV3RunResponse404
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
        )
    ).parsed
