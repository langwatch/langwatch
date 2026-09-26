from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_experiments_by_slug_run_body import PostApiExperimentsBySlugRunBody
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    slug: str,
    *,
    body: PostApiExperimentsBySlugRunBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/experiments/{slug}/run".format(
            slug=quote(str(slug), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if response.status_code == 400:
        return None

    if response.status_code == 401:
        return None

    if response.status_code == 404:
        return None

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
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
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PostApiExperimentsBySlugRunBody | Unset = UNSET,
) -> Response[Any]:
    """Run an experiment

     Start a run of a saved experiment, addressed by slug. Returns a runId to poll straight away. Send
    `Accept: text/event-stream` instead to stream progress events until the run finishes.

    Args:
        slug (str):
        body (PostApiExperimentsBySlugRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PostApiExperimentsBySlugRunBody | Unset = UNSET,
) -> Response[Any]:
    """Run an experiment

     Start a run of a saved experiment, addressed by slug. Returns a runId to poll straight away. Send
    `Accept: text/event-stream` instead to stream progress events until the run finishes.

    Args:
        slug (str):
        body (PostApiExperimentsBySlugRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
