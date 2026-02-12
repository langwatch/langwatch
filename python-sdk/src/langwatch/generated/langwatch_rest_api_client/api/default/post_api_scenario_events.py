from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_scenario_events_body_type_0 import PostApiScenarioEventsBodyType0
from ...models.post_api_scenario_events_body_type_1 import PostApiScenarioEventsBodyType1
from ...models.post_api_scenario_events_body_type_2 import PostApiScenarioEventsBodyType2
from ...models.post_api_scenario_events_response_201 import PostApiScenarioEventsResponse201
from ...models.post_api_scenario_events_response_400 import PostApiScenarioEventsResponse400
from ...models.post_api_scenario_events_response_401 import PostApiScenarioEventsResponse401
from ...models.post_api_scenario_events_response_422 import PostApiScenarioEventsResponse422
from ...models.post_api_scenario_events_response_500 import PostApiScenarioEventsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiScenarioEventsBodyType0
    | PostApiScenarioEventsBodyType1
    | PostApiScenarioEventsBodyType2
    | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/scenario-events",
    }

    if isinstance(body, PostApiScenarioEventsBodyType0):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, PostApiScenarioEventsBodyType1):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiScenarioEventsResponse201
    | PostApiScenarioEventsResponse400
    | PostApiScenarioEventsResponse401
    | PostApiScenarioEventsResponse422
    | PostApiScenarioEventsResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiScenarioEventsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiScenarioEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiScenarioEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiScenarioEventsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiScenarioEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiScenarioEventsResponse201
    | PostApiScenarioEventsResponse400
    | PostApiScenarioEventsResponse401
    | PostApiScenarioEventsResponse422
    | PostApiScenarioEventsResponse500
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
    body: PostApiScenarioEventsBodyType0
    | PostApiScenarioEventsBodyType1
    | PostApiScenarioEventsBodyType2
    | Unset = UNSET,
) -> Response[
    PostApiScenarioEventsResponse201
    | PostApiScenarioEventsResponse400
    | PostApiScenarioEventsResponse401
    | PostApiScenarioEventsResponse422
    | PostApiScenarioEventsResponse500
]:
    """Create a new scenario event

    Args:
        body (PostApiScenarioEventsBodyType0 | PostApiScenarioEventsBodyType1 |
            PostApiScenarioEventsBodyType2 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiScenarioEventsResponse201 | PostApiScenarioEventsResponse400 | PostApiScenarioEventsResponse401 | PostApiScenarioEventsResponse422 | PostApiScenarioEventsResponse500]
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
    body: PostApiScenarioEventsBodyType0
    | PostApiScenarioEventsBodyType1
    | PostApiScenarioEventsBodyType2
    | Unset = UNSET,
) -> (
    PostApiScenarioEventsResponse201
    | PostApiScenarioEventsResponse400
    | PostApiScenarioEventsResponse401
    | PostApiScenarioEventsResponse422
    | PostApiScenarioEventsResponse500
    | None
):
    """Create a new scenario event

    Args:
        body (PostApiScenarioEventsBodyType0 | PostApiScenarioEventsBodyType1 |
            PostApiScenarioEventsBodyType2 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiScenarioEventsResponse201 | PostApiScenarioEventsResponse400 | PostApiScenarioEventsResponse401 | PostApiScenarioEventsResponse422 | PostApiScenarioEventsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiScenarioEventsBodyType0
    | PostApiScenarioEventsBodyType1
    | PostApiScenarioEventsBodyType2
    | Unset = UNSET,
) -> Response[
    PostApiScenarioEventsResponse201
    | PostApiScenarioEventsResponse400
    | PostApiScenarioEventsResponse401
    | PostApiScenarioEventsResponse422
    | PostApiScenarioEventsResponse500
]:
    """Create a new scenario event

    Args:
        body (PostApiScenarioEventsBodyType0 | PostApiScenarioEventsBodyType1 |
            PostApiScenarioEventsBodyType2 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiScenarioEventsResponse201 | PostApiScenarioEventsResponse400 | PostApiScenarioEventsResponse401 | PostApiScenarioEventsResponse422 | PostApiScenarioEventsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiScenarioEventsBodyType0
    | PostApiScenarioEventsBodyType1
    | PostApiScenarioEventsBodyType2
    | Unset = UNSET,
) -> (
    PostApiScenarioEventsResponse201
    | PostApiScenarioEventsResponse400
    | PostApiScenarioEventsResponse401
    | PostApiScenarioEventsResponse422
    | PostApiScenarioEventsResponse500
    | None
):
    """Create a new scenario event

    Args:
        body (PostApiScenarioEventsBodyType0 | PostApiScenarioEventsBodyType1 |
            PostApiScenarioEventsBodyType2 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiScenarioEventsResponse201 | PostApiScenarioEventsResponse400 | PostApiScenarioEventsResponse401 | PostApiScenarioEventsResponse422 | PostApiScenarioEventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
