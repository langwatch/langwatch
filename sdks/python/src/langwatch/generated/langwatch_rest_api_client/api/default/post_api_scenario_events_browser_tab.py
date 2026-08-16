from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_scenario_events_browser_tab_body import PostApiScenarioEventsBrowserTabBody
from ...models.post_api_scenario_events_browser_tab_response_200 import PostApiScenarioEventsBrowserTabResponse200
from ...models.post_api_scenario_events_browser_tab_response_400 import PostApiScenarioEventsBrowserTabResponse400
from ...models.post_api_scenario_events_browser_tab_response_401 import PostApiScenarioEventsBrowserTabResponse401
from ...models.post_api_scenario_events_browser_tab_response_422 import PostApiScenarioEventsBrowserTabResponse422
from ...models.post_api_scenario_events_browser_tab_response_500 import PostApiScenarioEventsBrowserTabResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiScenarioEventsBrowserTabBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/scenario-events/browser-tab",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiScenarioEventsBrowserTabResponse200
    | PostApiScenarioEventsBrowserTabResponse400
    | PostApiScenarioEventsBrowserTabResponse401
    | PostApiScenarioEventsBrowserTabResponse422
    | PostApiScenarioEventsBrowserTabResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiScenarioEventsBrowserTabResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiScenarioEventsBrowserTabResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiScenarioEventsBrowserTabResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiScenarioEventsBrowserTabResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiScenarioEventsBrowserTabResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiScenarioEventsBrowserTabResponse200
    | PostApiScenarioEventsBrowserTabResponse400
    | PostApiScenarioEventsBrowserTabResponse401
    | PostApiScenarioEventsBrowserTabResponse422
    | PostApiScenarioEventsBrowserTabResponse500
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
    body: PostApiScenarioEventsBrowserTabBody | Unset = UNSET,
) -> Response[
    PostApiScenarioEventsBrowserTabResponse200
    | PostApiScenarioEventsBrowserTabResponse400
    | PostApiScenarioEventsBrowserTabResponse401
    | PostApiScenarioEventsBrowserTabResponse422
    | PostApiScenarioEventsBrowserTabResponse500
]:
    """Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live
    tab took it.

    Args:
        body (PostApiScenarioEventsBrowserTabBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiScenarioEventsBrowserTabResponse200 | PostApiScenarioEventsBrowserTabResponse400 | PostApiScenarioEventsBrowserTabResponse401 | PostApiScenarioEventsBrowserTabResponse422 | PostApiScenarioEventsBrowserTabResponse500]
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
    body: PostApiScenarioEventsBrowserTabBody | Unset = UNSET,
) -> (
    PostApiScenarioEventsBrowserTabResponse200
    | PostApiScenarioEventsBrowserTabResponse400
    | PostApiScenarioEventsBrowserTabResponse401
    | PostApiScenarioEventsBrowserTabResponse422
    | PostApiScenarioEventsBrowserTabResponse500
    | None
):
    """Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live
    tab took it.

    Args:
        body (PostApiScenarioEventsBrowserTabBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiScenarioEventsBrowserTabResponse200 | PostApiScenarioEventsBrowserTabResponse400 | PostApiScenarioEventsBrowserTabResponse401 | PostApiScenarioEventsBrowserTabResponse422 | PostApiScenarioEventsBrowserTabResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiScenarioEventsBrowserTabBody | Unset = UNSET,
) -> Response[
    PostApiScenarioEventsBrowserTabResponse200
    | PostApiScenarioEventsBrowserTabResponse400
    | PostApiScenarioEventsBrowserTabResponse401
    | PostApiScenarioEventsBrowserTabResponse422
    | PostApiScenarioEventsBrowserTabResponse500
]:
    """Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live
    tab took it.

    Args:
        body (PostApiScenarioEventsBrowserTabBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiScenarioEventsBrowserTabResponse200 | PostApiScenarioEventsBrowserTabResponse400 | PostApiScenarioEventsBrowserTabResponse401 | PostApiScenarioEventsBrowserTabResponse422 | PostApiScenarioEventsBrowserTabResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiScenarioEventsBrowserTabBody | Unset = UNSET,
) -> (
    PostApiScenarioEventsBrowserTabResponse200
    | PostApiScenarioEventsBrowserTabResponse400
    | PostApiScenarioEventsBrowserTabResponse401
    | PostApiScenarioEventsBrowserTabResponse422
    | PostApiScenarioEventsBrowserTabResponse500
    | None
):
    """Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live
    tab took it.

    Args:
        body (PostApiScenarioEventsBrowserTabBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiScenarioEventsBrowserTabResponse200 | PostApiScenarioEventsBrowserTabResponse400 | PostApiScenarioEventsBrowserTabResponse401 | PostApiScenarioEventsBrowserTabResponse422 | PostApiScenarioEventsBrowserTabResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
