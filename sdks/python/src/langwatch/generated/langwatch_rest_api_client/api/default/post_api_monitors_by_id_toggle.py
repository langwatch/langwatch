from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_monitors_by_id_toggle_body import PostApiMonitorsByIdToggleBody
from ...models.post_api_monitors_by_id_toggle_response_200 import PostApiMonitorsByIdToggleResponse200
from ...models.post_api_monitors_by_id_toggle_response_400 import PostApiMonitorsByIdToggleResponse400
from ...models.post_api_monitors_by_id_toggle_response_401 import PostApiMonitorsByIdToggleResponse401
from ...models.post_api_monitors_by_id_toggle_response_404 import PostApiMonitorsByIdToggleResponse404
from ...models.post_api_monitors_by_id_toggle_response_422 import PostApiMonitorsByIdToggleResponse422
from ...models.post_api_monitors_by_id_toggle_response_500 import PostApiMonitorsByIdToggleResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PostApiMonitorsByIdToggleBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/monitors/{id}/toggle".format(
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
    PostApiMonitorsByIdToggleResponse200
    | PostApiMonitorsByIdToggleResponse400
    | PostApiMonitorsByIdToggleResponse401
    | PostApiMonitorsByIdToggleResponse404
    | PostApiMonitorsByIdToggleResponse422
    | PostApiMonitorsByIdToggleResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiMonitorsByIdToggleResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiMonitorsByIdToggleResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiMonitorsByIdToggleResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiMonitorsByIdToggleResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PostApiMonitorsByIdToggleResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiMonitorsByIdToggleResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiMonitorsByIdToggleResponse200
    | PostApiMonitorsByIdToggleResponse400
    | PostApiMonitorsByIdToggleResponse401
    | PostApiMonitorsByIdToggleResponse404
    | PostApiMonitorsByIdToggleResponse422
    | PostApiMonitorsByIdToggleResponse500
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
    body: PostApiMonitorsByIdToggleBody,
) -> Response[
    PostApiMonitorsByIdToggleResponse200
    | PostApiMonitorsByIdToggleResponse400
    | PostApiMonitorsByIdToggleResponse401
    | PostApiMonitorsByIdToggleResponse404
    | PostApiMonitorsByIdToggleResponse422
    | PostApiMonitorsByIdToggleResponse500
]:
    """Enable or disable a monitor

    Args:
        id (str):
        body (PostApiMonitorsByIdToggleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiMonitorsByIdToggleResponse200 | PostApiMonitorsByIdToggleResponse400 | PostApiMonitorsByIdToggleResponse401 | PostApiMonitorsByIdToggleResponse404 | PostApiMonitorsByIdToggleResponse422 | PostApiMonitorsByIdToggleResponse500]
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
    body: PostApiMonitorsByIdToggleBody,
) -> (
    PostApiMonitorsByIdToggleResponse200
    | PostApiMonitorsByIdToggleResponse400
    | PostApiMonitorsByIdToggleResponse401
    | PostApiMonitorsByIdToggleResponse404
    | PostApiMonitorsByIdToggleResponse422
    | PostApiMonitorsByIdToggleResponse500
    | None
):
    """Enable or disable a monitor

    Args:
        id (str):
        body (PostApiMonitorsByIdToggleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiMonitorsByIdToggleResponse200 | PostApiMonitorsByIdToggleResponse400 | PostApiMonitorsByIdToggleResponse401 | PostApiMonitorsByIdToggleResponse404 | PostApiMonitorsByIdToggleResponse422 | PostApiMonitorsByIdToggleResponse500
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
    body: PostApiMonitorsByIdToggleBody,
) -> Response[
    PostApiMonitorsByIdToggleResponse200
    | PostApiMonitorsByIdToggleResponse400
    | PostApiMonitorsByIdToggleResponse401
    | PostApiMonitorsByIdToggleResponse404
    | PostApiMonitorsByIdToggleResponse422
    | PostApiMonitorsByIdToggleResponse500
]:
    """Enable or disable a monitor

    Args:
        id (str):
        body (PostApiMonitorsByIdToggleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiMonitorsByIdToggleResponse200 | PostApiMonitorsByIdToggleResponse400 | PostApiMonitorsByIdToggleResponse401 | PostApiMonitorsByIdToggleResponse404 | PostApiMonitorsByIdToggleResponse422 | PostApiMonitorsByIdToggleResponse500]
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
    body: PostApiMonitorsByIdToggleBody,
) -> (
    PostApiMonitorsByIdToggleResponse200
    | PostApiMonitorsByIdToggleResponse400
    | PostApiMonitorsByIdToggleResponse401
    | PostApiMonitorsByIdToggleResponse404
    | PostApiMonitorsByIdToggleResponse422
    | PostApiMonitorsByIdToggleResponse500
    | None
):
    """Enable or disable a monitor

    Args:
        id (str):
        body (PostApiMonitorsByIdToggleBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiMonitorsByIdToggleResponse200 | PostApiMonitorsByIdToggleResponse400 | PostApiMonitorsByIdToggleResponse401 | PostApiMonitorsByIdToggleResponse404 | PostApiMonitorsByIdToggleResponse422 | PostApiMonitorsByIdToggleResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
