from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_experiments_body import PostApiExperimentsBody
from ...models.post_api_experiments_response_200 import PostApiExperimentsResponse200
from ...models.post_api_experiments_response_400 import PostApiExperimentsResponse400
from ...models.post_api_experiments_response_401 import PostApiExperimentsResponse401
from ...models.post_api_experiments_response_422 import PostApiExperimentsResponse422
from ...models.post_api_experiments_response_500 import PostApiExperimentsResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiExperimentsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/experiments",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiExperimentsResponse200
    | PostApiExperimentsResponse400
    | PostApiExperimentsResponse401
    | PostApiExperimentsResponse422
    | PostApiExperimentsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiExperimentsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiExperimentsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiExperimentsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiExperimentsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiExperimentsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiExperimentsResponse200
    | PostApiExperimentsResponse400
    | PostApiExperimentsResponse401
    | PostApiExperimentsResponse422
    | PostApiExperimentsResponse500
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
    body: PostApiExperimentsBody,
) -> Response[
    PostApiExperimentsResponse200
    | PostApiExperimentsResponse400
    | PostApiExperimentsResponse401
    | PostApiExperimentsResponse422
    | PostApiExperimentsResponse500
]:
    """Create an experiment and its setup

     Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench
    with one inline dataset. The slug it answers with is what every other experiment endpoint takes.

    Args:
        body (PostApiExperimentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiExperimentsResponse200 | PostApiExperimentsResponse400 | PostApiExperimentsResponse401 | PostApiExperimentsResponse422 | PostApiExperimentsResponse500]
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
    body: PostApiExperimentsBody,
) -> (
    PostApiExperimentsResponse200
    | PostApiExperimentsResponse400
    | PostApiExperimentsResponse401
    | PostApiExperimentsResponse422
    | PostApiExperimentsResponse500
    | None
):
    """Create an experiment and its setup

     Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench
    with one inline dataset. The slug it answers with is what every other experiment endpoint takes.

    Args:
        body (PostApiExperimentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiExperimentsResponse200 | PostApiExperimentsResponse400 | PostApiExperimentsResponse401 | PostApiExperimentsResponse422 | PostApiExperimentsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiExperimentsBody,
) -> Response[
    PostApiExperimentsResponse200
    | PostApiExperimentsResponse400
    | PostApiExperimentsResponse401
    | PostApiExperimentsResponse422
    | PostApiExperimentsResponse500
]:
    """Create an experiment and its setup

     Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench
    with one inline dataset. The slug it answers with is what every other experiment endpoint takes.

    Args:
        body (PostApiExperimentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiExperimentsResponse200 | PostApiExperimentsResponse400 | PostApiExperimentsResponse401 | PostApiExperimentsResponse422 | PostApiExperimentsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiExperimentsBody,
) -> (
    PostApiExperimentsResponse200
    | PostApiExperimentsResponse400
    | PostApiExperimentsResponse401
    | PostApiExperimentsResponse422
    | PostApiExperimentsResponse500
    | None
):
    """Create an experiment and its setup

     Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench
    with one inline dataset. The slug it answers with is what every other experiment endpoint takes.

    Args:
        body (PostApiExperimentsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiExperimentsResponse200 | PostApiExperimentsResponse400 | PostApiExperimentsResponse401 | PostApiExperimentsResponse422 | PostApiExperimentsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
