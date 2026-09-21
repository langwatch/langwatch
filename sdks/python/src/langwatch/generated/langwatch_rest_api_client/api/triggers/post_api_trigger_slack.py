from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_trigger_slack_body import PostApiTriggerSlackBody
from ...models.post_api_trigger_slack_response_200 import PostApiTriggerSlackResponse200
from ...models.post_api_trigger_slack_response_400 import PostApiTriggerSlackResponse400
from ...models.post_api_trigger_slack_response_401 import PostApiTriggerSlackResponse401
from ...models.post_api_trigger_slack_response_403 import PostApiTriggerSlackResponse403
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiTriggerSlackBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/trigger/slack",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiTriggerSlackResponse200
    | PostApiTriggerSlackResponse400
    | PostApiTriggerSlackResponse401
    | PostApiTriggerSlackResponse403
    | None
):
    if response.status_code == 200:
        response_200 = PostApiTriggerSlackResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiTriggerSlackResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiTriggerSlackResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiTriggerSlackResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiTriggerSlackResponse200
    | PostApiTriggerSlackResponse400
    | PostApiTriggerSlackResponse401
    | PostApiTriggerSlackResponse403
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
    body: PostApiTriggerSlackBody,
) -> Response[
    PostApiTriggerSlackResponse200
    | PostApiTriggerSlackResponse400
    | PostApiTriggerSlackResponse401
    | PostApiTriggerSlackResponse403
]:
    """Create a Slack alert trigger

     Create a trigger that posts to a Slack incoming webhook when traces match its filters. The
    `/api/triggers` family supersedes this narrower form, which stays for callers written against it.

    Args:
        body (PostApiTriggerSlackBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggerSlackResponse200 | PostApiTriggerSlackResponse400 | PostApiTriggerSlackResponse401 | PostApiTriggerSlackResponse403]
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
    body: PostApiTriggerSlackBody,
) -> (
    PostApiTriggerSlackResponse200
    | PostApiTriggerSlackResponse400
    | PostApiTriggerSlackResponse401
    | PostApiTriggerSlackResponse403
    | None
):
    """Create a Slack alert trigger

     Create a trigger that posts to a Slack incoming webhook when traces match its filters. The
    `/api/triggers` family supersedes this narrower form, which stays for callers written against it.

    Args:
        body (PostApiTriggerSlackBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggerSlackResponse200 | PostApiTriggerSlackResponse400 | PostApiTriggerSlackResponse401 | PostApiTriggerSlackResponse403
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiTriggerSlackBody,
) -> Response[
    PostApiTriggerSlackResponse200
    | PostApiTriggerSlackResponse400
    | PostApiTriggerSlackResponse401
    | PostApiTriggerSlackResponse403
]:
    """Create a Slack alert trigger

     Create a trigger that posts to a Slack incoming webhook when traces match its filters. The
    `/api/triggers` family supersedes this narrower form, which stays for callers written against it.

    Args:
        body (PostApiTriggerSlackBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggerSlackResponse200 | PostApiTriggerSlackResponse400 | PostApiTriggerSlackResponse401 | PostApiTriggerSlackResponse403]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiTriggerSlackBody,
) -> (
    PostApiTriggerSlackResponse200
    | PostApiTriggerSlackResponse400
    | PostApiTriggerSlackResponse401
    | PostApiTriggerSlackResponse403
    | None
):
    """Create a Slack alert trigger

     Create a trigger that posts to a Slack incoming webhook when traces match its filters. The
    `/api/triggers` family supersedes this narrower form, which stays for callers written against it.

    Args:
        body (PostApiTriggerSlackBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggerSlackResponse200 | PostApiTriggerSlackResponse400 | PostApiTriggerSlackResponse401 | PostApiTriggerSlackResponse403
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
