from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_agents_by_id_call_body import PostApiAgentsByIdCallBody
from ...models.post_api_agents_by_id_call_response_200 import PostApiAgentsByIdCallResponse200
from ...models.post_api_agents_by_id_call_response_400 import PostApiAgentsByIdCallResponse400
from ...models.post_api_agents_by_id_call_response_401 import PostApiAgentsByIdCallResponse401
from ...models.post_api_agents_by_id_call_response_422 import PostApiAgentsByIdCallResponse422
from ...models.post_api_agents_by_id_call_response_500 import PostApiAgentsByIdCallResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PostApiAgentsByIdCallBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/agents/{id}/call".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    Any
    | PostApiAgentsByIdCallResponse200
    | PostApiAgentsByIdCallResponse400
    | PostApiAgentsByIdCallResponse401
    | PostApiAgentsByIdCallResponse422
    | PostApiAgentsByIdCallResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiAgentsByIdCallResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiAgentsByIdCallResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiAgentsByIdCallResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if response.status_code == 422:
        response_422 = PostApiAgentsByIdCallResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 429:
        response_429 = cast(Any, None)
        return response_429

    if response.status_code == 500:
        response_500 = PostApiAgentsByIdCallResponse500.from_dict(response.json())

        return response_500

    if response.status_code == 503:
        response_503 = cast(Any, None)
        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any
    | PostApiAgentsByIdCallResponse200
    | PostApiAgentsByIdCallResponse400
    | PostApiAgentsByIdCallResponse401
    | PostApiAgentsByIdCallResponse422
    | PostApiAgentsByIdCallResponse500
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
    id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentsByIdCallBody,
) -> Response[
    Any
    | PostApiAgentsByIdCallResponse200
    | PostApiAgentsByIdCallResponse400
    | PostApiAgentsByIdCallResponse401
    | PostApiAgentsByIdCallResponse422
    | PostApiAgentsByIdCallResponse500
]:
    """Send one conversation turn to a connected agent and get its answer. The agent must be online: a
    process running the decorated function must be connected.

    Args:
        id (str):
        body (PostApiAgentsByIdCallBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiAgentsByIdCallResponse200 | PostApiAgentsByIdCallResponse400 | PostApiAgentsByIdCallResponse401 | PostApiAgentsByIdCallResponse422 | PostApiAgentsByIdCallResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentsByIdCallBody,
) -> (
    Any
    | PostApiAgentsByIdCallResponse200
    | PostApiAgentsByIdCallResponse400
    | PostApiAgentsByIdCallResponse401
    | PostApiAgentsByIdCallResponse422
    | PostApiAgentsByIdCallResponse500
    | None
):
    """Send one conversation turn to a connected agent and get its answer. The agent must be online: a
    process running the decorated function must be connected.

    Args:
        id (str):
        body (PostApiAgentsByIdCallBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiAgentsByIdCallResponse200 | PostApiAgentsByIdCallResponse400 | PostApiAgentsByIdCallResponse401 | PostApiAgentsByIdCallResponse422 | PostApiAgentsByIdCallResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentsByIdCallBody,
) -> Response[
    Any
    | PostApiAgentsByIdCallResponse200
    | PostApiAgentsByIdCallResponse400
    | PostApiAgentsByIdCallResponse401
    | PostApiAgentsByIdCallResponse422
    | PostApiAgentsByIdCallResponse500
]:
    """Send one conversation turn to a connected agent and get its answer. The agent must be online: a
    process running the decorated function must be connected.

    Args:
        id (str):
        body (PostApiAgentsByIdCallBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiAgentsByIdCallResponse200 | PostApiAgentsByIdCallResponse400 | PostApiAgentsByIdCallResponse401 | PostApiAgentsByIdCallResponse422 | PostApiAgentsByIdCallResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiAgentsByIdCallBody,
) -> (
    Any
    | PostApiAgentsByIdCallResponse200
    | PostApiAgentsByIdCallResponse400
    | PostApiAgentsByIdCallResponse401
    | PostApiAgentsByIdCallResponse422
    | PostApiAgentsByIdCallResponse500
    | None
):
    """Send one conversation turn to a connected agent and get its answer. The agent must be online: a
    process running the decorated function must be connected.

    Args:
        id (str):
        body (PostApiAgentsByIdCallBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiAgentsByIdCallResponse200 | PostApiAgentsByIdCallResponse400 | PostApiAgentsByIdCallResponse401 | PostApiAgentsByIdCallResponse422 | PostApiAgentsByIdCallResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
