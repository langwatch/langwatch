from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_analytics_timeseries_body import PostApiAnalyticsTimeseriesBody
from ...models.post_api_analytics_timeseries_response_200 import PostApiAnalyticsTimeseriesResponse200
from ...models.post_api_analytics_timeseries_response_400 import PostApiAnalyticsTimeseriesResponse400
from ...models.post_api_analytics_timeseries_response_401 import PostApiAnalyticsTimeseriesResponse401
from ...models.post_api_analytics_timeseries_response_422 import PostApiAnalyticsTimeseriesResponse422
from ...models.post_api_analytics_timeseries_response_500 import PostApiAnalyticsTimeseriesResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiAnalyticsTimeseriesBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/analytics/timeseries",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiAnalyticsTimeseriesResponse200
    | PostApiAnalyticsTimeseriesResponse400
    | PostApiAnalyticsTimeseriesResponse401
    | PostApiAnalyticsTimeseriesResponse422
    | PostApiAnalyticsTimeseriesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiAnalyticsTimeseriesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiAnalyticsTimeseriesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiAnalyticsTimeseriesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiAnalyticsTimeseriesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiAnalyticsTimeseriesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiAnalyticsTimeseriesResponse200
    | PostApiAnalyticsTimeseriesResponse400
    | PostApiAnalyticsTimeseriesResponse401
    | PostApiAnalyticsTimeseriesResponse422
    | PostApiAnalyticsTimeseriesResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiAnalyticsTimeseriesBody | Unset = UNSET,
) -> Response[
    PostApiAnalyticsTimeseriesResponse200
    | PostApiAnalyticsTimeseriesResponse400
    | PostApiAnalyticsTimeseriesResponse401
    | PostApiAnalyticsTimeseriesResponse422
    | PostApiAnalyticsTimeseriesResponse500
]:
    """Query analytics timeseries data with metrics, aggregations, and filters

    Args:
        body (PostApiAnalyticsTimeseriesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiAnalyticsTimeseriesResponse200 | PostApiAnalyticsTimeseriesResponse400 | PostApiAnalyticsTimeseriesResponse401 | PostApiAnalyticsTimeseriesResponse422 | PostApiAnalyticsTimeseriesResponse500]
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
    client: AuthenticatedClient | Client,
    body: PostApiAnalyticsTimeseriesBody | Unset = UNSET,
) -> (
    PostApiAnalyticsTimeseriesResponse200
    | PostApiAnalyticsTimeseriesResponse400
    | PostApiAnalyticsTimeseriesResponse401
    | PostApiAnalyticsTimeseriesResponse422
    | PostApiAnalyticsTimeseriesResponse500
    | None
):
    """Query analytics timeseries data with metrics, aggregations, and filters

    Args:
        body (PostApiAnalyticsTimeseriesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiAnalyticsTimeseriesResponse200 | PostApiAnalyticsTimeseriesResponse400 | PostApiAnalyticsTimeseriesResponse401 | PostApiAnalyticsTimeseriesResponse422 | PostApiAnalyticsTimeseriesResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiAnalyticsTimeseriesBody | Unset = UNSET,
) -> Response[
    PostApiAnalyticsTimeseriesResponse200
    | PostApiAnalyticsTimeseriesResponse400
    | PostApiAnalyticsTimeseriesResponse401
    | PostApiAnalyticsTimeseriesResponse422
    | PostApiAnalyticsTimeseriesResponse500
]:
    """Query analytics timeseries data with metrics, aggregations, and filters

    Args:
        body (PostApiAnalyticsTimeseriesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiAnalyticsTimeseriesResponse200 | PostApiAnalyticsTimeseriesResponse400 | PostApiAnalyticsTimeseriesResponse401 | PostApiAnalyticsTimeseriesResponse422 | PostApiAnalyticsTimeseriesResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiAnalyticsTimeseriesBody | Unset = UNSET,
) -> (
    PostApiAnalyticsTimeseriesResponse200
    | PostApiAnalyticsTimeseriesResponse400
    | PostApiAnalyticsTimeseriesResponse401
    | PostApiAnalyticsTimeseriesResponse422
    | PostApiAnalyticsTimeseriesResponse500
    | None
):
    """Query analytics timeseries data with metrics, aggregations, and filters

    Args:
        body (PostApiAnalyticsTimeseriesBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiAnalyticsTimeseriesResponse200 | PostApiAnalyticsTimeseriesResponse400 | PostApiAnalyticsTimeseriesResponse401 | PostApiAnalyticsTimeseriesResponse422 | PostApiAnalyticsTimeseriesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
