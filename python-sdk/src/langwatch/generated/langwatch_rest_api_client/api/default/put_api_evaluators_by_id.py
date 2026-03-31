from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_evaluators_by_id_body import PutApiEvaluatorsByIdBody
from ...models.put_api_evaluators_by_id_response_200 import PutApiEvaluatorsByIdResponse200
from ...models.put_api_evaluators_by_id_response_400 import PutApiEvaluatorsByIdResponse400
from ...models.put_api_evaluators_by_id_response_401 import PutApiEvaluatorsByIdResponse401
from ...models.put_api_evaluators_by_id_response_404 import PutApiEvaluatorsByIdResponse404
from ...models.put_api_evaluators_by_id_response_422 import PutApiEvaluatorsByIdResponse422
from ...models.put_api_evaluators_by_id_response_500 import PutApiEvaluatorsByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: PutApiEvaluatorsByIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": f"/api/evaluators/{id}",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        PutApiEvaluatorsByIdResponse200,
        PutApiEvaluatorsByIdResponse400,
        PutApiEvaluatorsByIdResponse401,
        PutApiEvaluatorsByIdResponse404,
        PutApiEvaluatorsByIdResponse422,
        PutApiEvaluatorsByIdResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = PutApiEvaluatorsByIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = PutApiEvaluatorsByIdResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = PutApiEvaluatorsByIdResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = PutApiEvaluatorsByIdResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 422:
        response_422 = PutApiEvaluatorsByIdResponse422.from_dict(response.json())

        return response_422
    if response.status_code == 500:
        response_500 = PutApiEvaluatorsByIdResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        PutApiEvaluatorsByIdResponse200,
        PutApiEvaluatorsByIdResponse400,
        PutApiEvaluatorsByIdResponse401,
        PutApiEvaluatorsByIdResponse404,
        PutApiEvaluatorsByIdResponse422,
        PutApiEvaluatorsByIdResponse500,
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
    body: PutApiEvaluatorsByIdBody,
) -> Response[
    Union[
        PutApiEvaluatorsByIdResponse200,
        PutApiEvaluatorsByIdResponse400,
        PutApiEvaluatorsByIdResponse401,
        PutApiEvaluatorsByIdResponse404,
        PutApiEvaluatorsByIdResponse422,
        PutApiEvaluatorsByIdResponse500,
    ]
]:
    """Update an existing evaluator

    Args:
        id (str):
        body (PutApiEvaluatorsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PutApiEvaluatorsByIdResponse200, PutApiEvaluatorsByIdResponse400, PutApiEvaluatorsByIdResponse401, PutApiEvaluatorsByIdResponse404, PutApiEvaluatorsByIdResponse422, PutApiEvaluatorsByIdResponse500]]
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
    client: Union[AuthenticatedClient, Client],
    body: PutApiEvaluatorsByIdBody,
) -> Optional[
    Union[
        PutApiEvaluatorsByIdResponse200,
        PutApiEvaluatorsByIdResponse400,
        PutApiEvaluatorsByIdResponse401,
        PutApiEvaluatorsByIdResponse404,
        PutApiEvaluatorsByIdResponse422,
        PutApiEvaluatorsByIdResponse500,
    ]
]:
    """Update an existing evaluator

    Args:
        id (str):
        body (PutApiEvaluatorsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PutApiEvaluatorsByIdResponse200, PutApiEvaluatorsByIdResponse400, PutApiEvaluatorsByIdResponse401, PutApiEvaluatorsByIdResponse404, PutApiEvaluatorsByIdResponse422, PutApiEvaluatorsByIdResponse500]
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PutApiEvaluatorsByIdBody,
) -> Response[
    Union[
        PutApiEvaluatorsByIdResponse200,
        PutApiEvaluatorsByIdResponse400,
        PutApiEvaluatorsByIdResponse401,
        PutApiEvaluatorsByIdResponse404,
        PutApiEvaluatorsByIdResponse422,
        PutApiEvaluatorsByIdResponse500,
    ]
]:
    """Update an existing evaluator

    Args:
        id (str):
        body (PutApiEvaluatorsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PutApiEvaluatorsByIdResponse200, PutApiEvaluatorsByIdResponse400, PutApiEvaluatorsByIdResponse401, PutApiEvaluatorsByIdResponse404, PutApiEvaluatorsByIdResponse422, PutApiEvaluatorsByIdResponse500]]
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
    client: Union[AuthenticatedClient, Client],
    body: PutApiEvaluatorsByIdBody,
) -> Optional[
    Union[
        PutApiEvaluatorsByIdResponse200,
        PutApiEvaluatorsByIdResponse400,
        PutApiEvaluatorsByIdResponse401,
        PutApiEvaluatorsByIdResponse404,
        PutApiEvaluatorsByIdResponse422,
        PutApiEvaluatorsByIdResponse500,
    ]
]:
    """Update an existing evaluator

    Args:
        id (str):
        body (PutApiEvaluatorsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PutApiEvaluatorsByIdResponse200, PutApiEvaluatorsByIdResponse400, PutApiEvaluatorsByIdResponse401, PutApiEvaluatorsByIdResponse404, PutApiEvaluatorsByIdResponse422, PutApiEvaluatorsByIdResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
