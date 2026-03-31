from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_evaluators_by_id_response_200 import DeleteApiEvaluatorsByIdResponse200
from ...models.delete_api_evaluators_by_id_response_400 import DeleteApiEvaluatorsByIdResponse400
from ...models.delete_api_evaluators_by_id_response_401 import DeleteApiEvaluatorsByIdResponse401
from ...models.delete_api_evaluators_by_id_response_404 import DeleteApiEvaluatorsByIdResponse404
from ...models.delete_api_evaluators_by_id_response_422 import DeleteApiEvaluatorsByIdResponse422
from ...models.delete_api_evaluators_by_id_response_500 import DeleteApiEvaluatorsByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": f"/api/evaluators/{id}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        DeleteApiEvaluatorsByIdResponse200,
        DeleteApiEvaluatorsByIdResponse400,
        DeleteApiEvaluatorsByIdResponse401,
        DeleteApiEvaluatorsByIdResponse404,
        DeleteApiEvaluatorsByIdResponse422,
        DeleteApiEvaluatorsByIdResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = DeleteApiEvaluatorsByIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = DeleteApiEvaluatorsByIdResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = DeleteApiEvaluatorsByIdResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = DeleteApiEvaluatorsByIdResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 422:
        response_422 = DeleteApiEvaluatorsByIdResponse422.from_dict(response.json())

        return response_422
    if response.status_code == 500:
        response_500 = DeleteApiEvaluatorsByIdResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        DeleteApiEvaluatorsByIdResponse200,
        DeleteApiEvaluatorsByIdResponse400,
        DeleteApiEvaluatorsByIdResponse401,
        DeleteApiEvaluatorsByIdResponse404,
        DeleteApiEvaluatorsByIdResponse422,
        DeleteApiEvaluatorsByIdResponse500,
    ]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        DeleteApiEvaluatorsByIdResponse200,
        DeleteApiEvaluatorsByIdResponse400,
        DeleteApiEvaluatorsByIdResponse401,
        DeleteApiEvaluatorsByIdResponse404,
        DeleteApiEvaluatorsByIdResponse422,
        DeleteApiEvaluatorsByIdResponse500,
    ]
]:
    """Archive (soft-delete) an evaluator

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[DeleteApiEvaluatorsByIdResponse200, DeleteApiEvaluatorsByIdResponse400, DeleteApiEvaluatorsByIdResponse401, DeleteApiEvaluatorsByIdResponse404, DeleteApiEvaluatorsByIdResponse422, DeleteApiEvaluatorsByIdResponse500]]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        DeleteApiEvaluatorsByIdResponse200,
        DeleteApiEvaluatorsByIdResponse400,
        DeleteApiEvaluatorsByIdResponse401,
        DeleteApiEvaluatorsByIdResponse404,
        DeleteApiEvaluatorsByIdResponse422,
        DeleteApiEvaluatorsByIdResponse500,
    ]
]:
    """Archive (soft-delete) an evaluator

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[DeleteApiEvaluatorsByIdResponse200, DeleteApiEvaluatorsByIdResponse400, DeleteApiEvaluatorsByIdResponse401, DeleteApiEvaluatorsByIdResponse404, DeleteApiEvaluatorsByIdResponse422, DeleteApiEvaluatorsByIdResponse500]
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        DeleteApiEvaluatorsByIdResponse200,
        DeleteApiEvaluatorsByIdResponse400,
        DeleteApiEvaluatorsByIdResponse401,
        DeleteApiEvaluatorsByIdResponse404,
        DeleteApiEvaluatorsByIdResponse422,
        DeleteApiEvaluatorsByIdResponse500,
    ]
]:
    """Archive (soft-delete) an evaluator

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[DeleteApiEvaluatorsByIdResponse200, DeleteApiEvaluatorsByIdResponse400, DeleteApiEvaluatorsByIdResponse401, DeleteApiEvaluatorsByIdResponse404, DeleteApiEvaluatorsByIdResponse422, DeleteApiEvaluatorsByIdResponse500]]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        DeleteApiEvaluatorsByIdResponse200,
        DeleteApiEvaluatorsByIdResponse400,
        DeleteApiEvaluatorsByIdResponse401,
        DeleteApiEvaluatorsByIdResponse404,
        DeleteApiEvaluatorsByIdResponse422,
        DeleteApiEvaluatorsByIdResponse500,
    ]
]:
    """Archive (soft-delete) an evaluator

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[DeleteApiEvaluatorsByIdResponse200, DeleteApiEvaluatorsByIdResponse400, DeleteApiEvaluatorsByIdResponse401, DeleteApiEvaluatorsByIdResponse404, DeleteApiEvaluatorsByIdResponse422, DeleteApiEvaluatorsByIdResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
