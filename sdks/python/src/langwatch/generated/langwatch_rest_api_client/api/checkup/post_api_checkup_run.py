from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_checkup_run_body import PostApiCheckupRunBody
from ...models.post_api_checkup_run_response_200 import PostApiCheckupRunResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiCheckupRunBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/checkup/run",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | PostApiCheckupRunResponse200 | None:
    if response.status_code == 200:
        response_200 = PostApiCheckupRunResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | PostApiCheckupRunResponse200]:
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
    body: PostApiCheckupRunBody | Unset = UNSET,
) -> Response[Any | PostApiCheckupRunResponse200]:
    """Run the checks that open a connection or spend money

     Runs the egress and paid checks of a self-hosted install: reaching the connect and gateway hosts,
    the storage write, the SMTP connection, one model provider call and the pipeline canaries. Name the
    checks to run, or leave the list out to run them all. The scenario canary launches a real run and
    needs a run plan id. Answers 404 on LangWatch Cloud.

    Args:
        body (PostApiCheckupRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiCheckupRunResponse200]
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
    body: PostApiCheckupRunBody | Unset = UNSET,
) -> Any | PostApiCheckupRunResponse200 | None:
    """Run the checks that open a connection or spend money

     Runs the egress and paid checks of a self-hosted install: reaching the connect and gateway hosts,
    the storage write, the SMTP connection, one model provider call and the pipeline canaries. Name the
    checks to run, or leave the list out to run them all. The scenario canary launches a real run and
    needs a run plan id. Answers 404 on LangWatch Cloud.

    Args:
        body (PostApiCheckupRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiCheckupRunResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiCheckupRunBody | Unset = UNSET,
) -> Response[Any | PostApiCheckupRunResponse200]:
    """Run the checks that open a connection or spend money

     Runs the egress and paid checks of a self-hosted install: reaching the connect and gateway hosts,
    the storage write, the SMTP connection, one model provider call and the pipeline canaries. Name the
    checks to run, or leave the list out to run them all. The scenario canary launches a real run and
    needs a run plan id. Answers 404 on LangWatch Cloud.

    Args:
        body (PostApiCheckupRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiCheckupRunResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiCheckupRunBody | Unset = UNSET,
) -> Any | PostApiCheckupRunResponse200 | None:
    """Run the checks that open a connection or spend money

     Runs the egress and paid checks of a self-hosted install: reaching the connect and gateway hosts,
    the storage write, the SMTP connection, one model provider call and the pipeline canaries. Name the
    checks to run, or leave the list out to run them all. The scenario canary launches a real run and
    needs a run plan id. Answers 404 on LangWatch Cloud.

    Args:
        body (PostApiCheckupRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiCheckupRunResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
