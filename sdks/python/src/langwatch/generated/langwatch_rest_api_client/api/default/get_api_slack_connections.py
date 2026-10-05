from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_slack_connections_response_200_item import GetApiSlackConnectionsResponse200Item
from ...models.get_api_slack_connections_response_400 import GetApiSlackConnectionsResponse400
from ...models.get_api_slack_connections_response_401 import GetApiSlackConnectionsResponse401
from ...models.get_api_slack_connections_response_422 import GetApiSlackConnectionsResponse422
from ...models.get_api_slack_connections_response_500 import GetApiSlackConnectionsResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/slack-connections",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSlackConnectionsResponse400
    | GetApiSlackConnectionsResponse401
    | GetApiSlackConnectionsResponse422
    | GetApiSlackConnectionsResponse500
    | list[GetApiSlackConnectionsResponse200Item]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiSlackConnectionsResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSlackConnectionsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSlackConnectionsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiSlackConnectionsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSlackConnectionsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSlackConnectionsResponse400
    | GetApiSlackConnectionsResponse401
    | GetApiSlackConnectionsResponse422
    | GetApiSlackConnectionsResponse500
    | list[GetApiSlackConnectionsResponse200Item]
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
) -> Response[
    GetApiSlackConnectionsResponse400
    | GetApiSlackConnectionsResponse401
    | GetApiSlackConnectionsResponse422
    | GetApiSlackConnectionsResponse500
    | list[GetApiSlackConnectionsResponse200Item]
]:
    """List the Slack connections this project can deliver through: its own and its organization's, by
    name. Never returns a token or webhook URL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSlackConnectionsResponse400 | GetApiSlackConnectionsResponse401 | GetApiSlackConnectionsResponse422 | GetApiSlackConnectionsResponse500 | list[GetApiSlackConnectionsResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiSlackConnectionsResponse400
    | GetApiSlackConnectionsResponse401
    | GetApiSlackConnectionsResponse422
    | GetApiSlackConnectionsResponse500
    | list[GetApiSlackConnectionsResponse200Item]
    | None
):
    """List the Slack connections this project can deliver through: its own and its organization's, by
    name. Never returns a token or webhook URL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSlackConnectionsResponse400 | GetApiSlackConnectionsResponse401 | GetApiSlackConnectionsResponse422 | GetApiSlackConnectionsResponse500 | list[GetApiSlackConnectionsResponse200Item]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiSlackConnectionsResponse400
    | GetApiSlackConnectionsResponse401
    | GetApiSlackConnectionsResponse422
    | GetApiSlackConnectionsResponse500
    | list[GetApiSlackConnectionsResponse200Item]
]:
    """List the Slack connections this project can deliver through: its own and its organization's, by
    name. Never returns a token or webhook URL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSlackConnectionsResponse400 | GetApiSlackConnectionsResponse401 | GetApiSlackConnectionsResponse422 | GetApiSlackConnectionsResponse500 | list[GetApiSlackConnectionsResponse200Item]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiSlackConnectionsResponse400
    | GetApiSlackConnectionsResponse401
    | GetApiSlackConnectionsResponse422
    | GetApiSlackConnectionsResponse500
    | list[GetApiSlackConnectionsResponse200Item]
    | None
):
    """List the Slack connections this project can deliver through: its own and its organization's, by
    name. Never returns a token or webhook URL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSlackConnectionsResponse400 | GetApiSlackConnectionsResponse401 | GetApiSlackConnectionsResponse422 | GetApiSlackConnectionsResponse500 | list[GetApiSlackConnectionsResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
