from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_evaluators_by_id_or_slug_response_200 import GetApiEvaluatorsByIdOrSlugResponse200
from ...models.get_api_evaluators_by_id_or_slug_response_400 import GetApiEvaluatorsByIdOrSlugResponse400
from ...models.get_api_evaluators_by_id_or_slug_response_401 import GetApiEvaluatorsByIdOrSlugResponse401
from ...models.get_api_evaluators_by_id_or_slug_response_404 import GetApiEvaluatorsByIdOrSlugResponse404
from ...models.get_api_evaluators_by_id_or_slug_response_422 import GetApiEvaluatorsByIdOrSlugResponse422
from ...models.get_api_evaluators_by_id_or_slug_response_500 import GetApiEvaluatorsByIdOrSlugResponse500
from ...types import Response


def _get_kwargs(
    id_or_slug: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/evaluators/{id_or_slug}".format(
            id_or_slug=quote(str(id_or_slug), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiEvaluatorsByIdOrSlugResponse200
    | GetApiEvaluatorsByIdOrSlugResponse400
    | GetApiEvaluatorsByIdOrSlugResponse401
    | GetApiEvaluatorsByIdOrSlugResponse404
    | GetApiEvaluatorsByIdOrSlugResponse422
    | GetApiEvaluatorsByIdOrSlugResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiEvaluatorsByIdOrSlugResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiEvaluatorsByIdOrSlugResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiEvaluatorsByIdOrSlugResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiEvaluatorsByIdOrSlugResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiEvaluatorsByIdOrSlugResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiEvaluatorsByIdOrSlugResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiEvaluatorsByIdOrSlugResponse200
    | GetApiEvaluatorsByIdOrSlugResponse400
    | GetApiEvaluatorsByIdOrSlugResponse401
    | GetApiEvaluatorsByIdOrSlugResponse404
    | GetApiEvaluatorsByIdOrSlugResponse422
    | GetApiEvaluatorsByIdOrSlugResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id_or_slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiEvaluatorsByIdOrSlugResponse200
    | GetApiEvaluatorsByIdOrSlugResponse400
    | GetApiEvaluatorsByIdOrSlugResponse401
    | GetApiEvaluatorsByIdOrSlugResponse404
    | GetApiEvaluatorsByIdOrSlugResponse422
    | GetApiEvaluatorsByIdOrSlugResponse500
]:
    """Get a specific evaluator by ID or slug

    Args:
        id_or_slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse400 | GetApiEvaluatorsByIdOrSlugResponse401 | GetApiEvaluatorsByIdOrSlugResponse404 | GetApiEvaluatorsByIdOrSlugResponse422 | GetApiEvaluatorsByIdOrSlugResponse500]
    """

    kwargs = _get_kwargs(
        id_or_slug=id_or_slug,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id_or_slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiEvaluatorsByIdOrSlugResponse200
    | GetApiEvaluatorsByIdOrSlugResponse400
    | GetApiEvaluatorsByIdOrSlugResponse401
    | GetApiEvaluatorsByIdOrSlugResponse404
    | GetApiEvaluatorsByIdOrSlugResponse422
    | GetApiEvaluatorsByIdOrSlugResponse500
    | None
):
    """Get a specific evaluator by ID or slug

    Args:
        id_or_slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse400 | GetApiEvaluatorsByIdOrSlugResponse401 | GetApiEvaluatorsByIdOrSlugResponse404 | GetApiEvaluatorsByIdOrSlugResponse422 | GetApiEvaluatorsByIdOrSlugResponse500
    """

    return sync_detailed(
        id_or_slug=id_or_slug,
        client=client,
    ).parsed


async def asyncio_detailed(
    id_or_slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiEvaluatorsByIdOrSlugResponse200
    | GetApiEvaluatorsByIdOrSlugResponse400
    | GetApiEvaluatorsByIdOrSlugResponse401
    | GetApiEvaluatorsByIdOrSlugResponse404
    | GetApiEvaluatorsByIdOrSlugResponse422
    | GetApiEvaluatorsByIdOrSlugResponse500
]:
    """Get a specific evaluator by ID or slug

    Args:
        id_or_slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse400 | GetApiEvaluatorsByIdOrSlugResponse401 | GetApiEvaluatorsByIdOrSlugResponse404 | GetApiEvaluatorsByIdOrSlugResponse422 | GetApiEvaluatorsByIdOrSlugResponse500]
    """

    kwargs = _get_kwargs(
        id_or_slug=id_or_slug,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id_or_slug: str,
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiEvaluatorsByIdOrSlugResponse200
    | GetApiEvaluatorsByIdOrSlugResponse400
    | GetApiEvaluatorsByIdOrSlugResponse401
    | GetApiEvaluatorsByIdOrSlugResponse404
    | GetApiEvaluatorsByIdOrSlugResponse422
    | GetApiEvaluatorsByIdOrSlugResponse500
    | None
):
    """Get a specific evaluator by ID or slug

    Args:
        id_or_slug (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse400 | GetApiEvaluatorsByIdOrSlugResponse401 | GetApiEvaluatorsByIdOrSlugResponse404 | GetApiEvaluatorsByIdOrSlugResponse422 | GetApiEvaluatorsByIdOrSlugResponse500
    """

    return (
        await asyncio_detailed(
            id_or_slug=id_or_slug,
            client=client,
        )
    ).parsed
