from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_evaluators_body import PostApiEvaluatorsBody
from ...models.post_api_evaluators_response_200 import PostApiEvaluatorsResponse200
from ...models.post_api_evaluators_response_400 import PostApiEvaluatorsResponse400
from ...models.post_api_evaluators_response_401 import PostApiEvaluatorsResponse401
from ...models.post_api_evaluators_response_422 import PostApiEvaluatorsResponse422
from ...models.post_api_evaluators_response_500 import PostApiEvaluatorsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiEvaluatorsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/evaluators",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiEvaluatorsResponse200
    | PostApiEvaluatorsResponse400
    | PostApiEvaluatorsResponse401
    | PostApiEvaluatorsResponse422
    | PostApiEvaluatorsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiEvaluatorsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiEvaluatorsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiEvaluatorsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiEvaluatorsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiEvaluatorsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiEvaluatorsResponse200
    | PostApiEvaluatorsResponse400
    | PostApiEvaluatorsResponse401
    | PostApiEvaluatorsResponse422
    | PostApiEvaluatorsResponse500
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
    body: PostApiEvaluatorsBody | Unset = UNSET,
) -> Response[
    PostApiEvaluatorsResponse200
    | PostApiEvaluatorsResponse400
    | PostApiEvaluatorsResponse401
    | PostApiEvaluatorsResponse422
    | PostApiEvaluatorsResponse500
]:
    """Create a new evaluator

    Args:
        body (PostApiEvaluatorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEvaluatorsResponse200 | PostApiEvaluatorsResponse400 | PostApiEvaluatorsResponse401 | PostApiEvaluatorsResponse422 | PostApiEvaluatorsResponse500]
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
    body: PostApiEvaluatorsBody | Unset = UNSET,
) -> (
    PostApiEvaluatorsResponse200
    | PostApiEvaluatorsResponse400
    | PostApiEvaluatorsResponse401
    | PostApiEvaluatorsResponse422
    | PostApiEvaluatorsResponse500
    | None
):
    """Create a new evaluator

    Args:
        body (PostApiEvaluatorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEvaluatorsResponse200 | PostApiEvaluatorsResponse400 | PostApiEvaluatorsResponse401 | PostApiEvaluatorsResponse422 | PostApiEvaluatorsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiEvaluatorsBody | Unset = UNSET,
) -> Response[
    PostApiEvaluatorsResponse200
    | PostApiEvaluatorsResponse400
    | PostApiEvaluatorsResponse401
    | PostApiEvaluatorsResponse422
    | PostApiEvaluatorsResponse500
]:
    """Create a new evaluator

    Args:
        body (PostApiEvaluatorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEvaluatorsResponse200 | PostApiEvaluatorsResponse400 | PostApiEvaluatorsResponse401 | PostApiEvaluatorsResponse422 | PostApiEvaluatorsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostApiEvaluatorsBody | Unset = UNSET,
) -> (
    PostApiEvaluatorsResponse200
    | PostApiEvaluatorsResponse400
    | PostApiEvaluatorsResponse401
    | PostApiEvaluatorsResponse422
    | PostApiEvaluatorsResponse500
    | None
):
    """Create a new evaluator

    Args:
        body (PostApiEvaluatorsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEvaluatorsResponse200 | PostApiEvaluatorsResponse400 | PostApiEvaluatorsResponse401 | PostApiEvaluatorsResponse422 | PostApiEvaluatorsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
