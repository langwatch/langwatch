from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_scenarios_body import PostApiScenariosBody
from ...models.post_api_scenarios_response_201 import PostApiScenariosResponse201
from ...models.post_api_scenarios_response_400 import PostApiScenariosResponse400
from ...models.post_api_scenarios_response_401 import PostApiScenariosResponse401
from ...models.post_api_scenarios_response_422 import PostApiScenariosResponse422
from ...models.post_api_scenarios_response_500 import PostApiScenariosResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiScenariosBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/scenarios",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiScenariosResponse201
    | PostApiScenariosResponse400
    | PostApiScenariosResponse401
    | PostApiScenariosResponse422
    | PostApiScenariosResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostApiScenariosResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiScenariosResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiScenariosResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiScenariosResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiScenariosResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiScenariosResponse201
    | PostApiScenariosResponse400
    | PostApiScenariosResponse401
    | PostApiScenariosResponse422
    | PostApiScenariosResponse500
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
    body: PostApiScenariosBody | Unset = UNSET,
) -> Response[
    PostApiScenariosResponse201
    | PostApiScenariosResponse400
    | PostApiScenariosResponse401
    | PostApiScenariosResponse422
    | PostApiScenariosResponse500
]:
    """Create a new scenario

    Args:
        body (PostApiScenariosBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiScenariosResponse201 | PostApiScenariosResponse400 | PostApiScenariosResponse401 | PostApiScenariosResponse422 | PostApiScenariosResponse500]
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
    body: PostApiScenariosBody | Unset = UNSET,
) -> (
    PostApiScenariosResponse201
    | PostApiScenariosResponse400
    | PostApiScenariosResponse401
    | PostApiScenariosResponse422
    | PostApiScenariosResponse500
    | None
):
    """Create a new scenario

    Args:
        body (PostApiScenariosBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiScenariosResponse201 | PostApiScenariosResponse400 | PostApiScenariosResponse401 | PostApiScenariosResponse422 | PostApiScenariosResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiScenariosBody | Unset = UNSET,
) -> Response[
    PostApiScenariosResponse201
    | PostApiScenariosResponse400
    | PostApiScenariosResponse401
    | PostApiScenariosResponse422
    | PostApiScenariosResponse500
]:
    """Create a new scenario

    Args:
        body (PostApiScenariosBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiScenariosResponse201 | PostApiScenariosResponse400 | PostApiScenariosResponse401 | PostApiScenariosResponse422 | PostApiScenariosResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiScenariosBody | Unset = UNSET,
) -> (
    PostApiScenariosResponse201
    | PostApiScenariosResponse400
    | PostApiScenariosResponse401
    | PostApiScenariosResponse422
    | PostApiScenariosResponse500
    | None
):
    """Create a new scenario

    Args:
        body (PostApiScenariosBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiScenariosResponse201 | PostApiScenariosResponse400 | PostApiScenariosResponse401 | PostApiScenariosResponse422 | PostApiScenariosResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
