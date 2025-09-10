from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_evaluations_by_evaluator_evaluate_response_200 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse200,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_400 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse400,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_401 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse401,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_500 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse500,
)
from ...types import Response


def _get_kwargs(
    evaluator: str,
    *,
    body: Any,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/evaluations/{evaluator}/evaluate",
    }

    _kwargs["json"] = body

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        PostApiEvaluationsByEvaluatorEvaluateResponse200,
        PostApiEvaluationsByEvaluatorEvaluateResponse400,
        PostApiEvaluationsByEvaluatorEvaluateResponse401,
        PostApiEvaluationsByEvaluatorEvaluateResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = PostApiEvaluationsByEvaluatorEvaluateResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = PostApiEvaluationsByEvaluatorEvaluateResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = PostApiEvaluationsByEvaluatorEvaluateResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 500:
        response_500 = PostApiEvaluationsByEvaluatorEvaluateResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        PostApiEvaluationsByEvaluatorEvaluateResponse200,
        PostApiEvaluationsByEvaluatorEvaluateResponse400,
        PostApiEvaluationsByEvaluatorEvaluateResponse401,
        PostApiEvaluationsByEvaluatorEvaluateResponse500,
    ]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    evaluator: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: Any,
) -> Response[
    Union[
        PostApiEvaluationsByEvaluatorEvaluateResponse200,
        PostApiEvaluationsByEvaluatorEvaluateResponse400,
        PostApiEvaluationsByEvaluatorEvaluateResponse401,
        PostApiEvaluationsByEvaluatorEvaluateResponse500,
    ]
]:
    """Run evaluation with a specific evaluator

    Args:
        evaluator (str):
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PostApiEvaluationsByEvaluatorEvaluateResponse200, PostApiEvaluationsByEvaluatorEvaluateResponse400, PostApiEvaluationsByEvaluatorEvaluateResponse401, PostApiEvaluationsByEvaluatorEvaluateResponse500]]
    """

    kwargs = _get_kwargs(
        evaluator=evaluator,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    evaluator: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: Any,
) -> Optional[
    Union[
        PostApiEvaluationsByEvaluatorEvaluateResponse200,
        PostApiEvaluationsByEvaluatorEvaluateResponse400,
        PostApiEvaluationsByEvaluatorEvaluateResponse401,
        PostApiEvaluationsByEvaluatorEvaluateResponse500,
    ]
]:
    """Run evaluation with a specific evaluator

    Args:
        evaluator (str):
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PostApiEvaluationsByEvaluatorEvaluateResponse200, PostApiEvaluationsByEvaluatorEvaluateResponse400, PostApiEvaluationsByEvaluatorEvaluateResponse401, PostApiEvaluationsByEvaluatorEvaluateResponse500]
    """

    return sync_detailed(
        evaluator=evaluator,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    evaluator: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: Any,
) -> Response[
    Union[
        PostApiEvaluationsByEvaluatorEvaluateResponse200,
        PostApiEvaluationsByEvaluatorEvaluateResponse400,
        PostApiEvaluationsByEvaluatorEvaluateResponse401,
        PostApiEvaluationsByEvaluatorEvaluateResponse500,
    ]
]:
    """Run evaluation with a specific evaluator

    Args:
        evaluator (str):
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PostApiEvaluationsByEvaluatorEvaluateResponse200, PostApiEvaluationsByEvaluatorEvaluateResponse400, PostApiEvaluationsByEvaluatorEvaluateResponse401, PostApiEvaluationsByEvaluatorEvaluateResponse500]]
    """

    kwargs = _get_kwargs(
        evaluator=evaluator,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    evaluator: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: Any,
) -> Optional[
    Union[
        PostApiEvaluationsByEvaluatorEvaluateResponse200,
        PostApiEvaluationsByEvaluatorEvaluateResponse400,
        PostApiEvaluationsByEvaluatorEvaluateResponse401,
        PostApiEvaluationsByEvaluatorEvaluateResponse500,
    ]
]:
    """Run evaluation with a specific evaluator

    Args:
        evaluator (str):
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PostApiEvaluationsByEvaluatorEvaluateResponse200, PostApiEvaluationsByEvaluatorEvaluateResponse400, PostApiEvaluationsByEvaluatorEvaluateResponse401, PostApiEvaluationsByEvaluatorEvaluateResponse500]
    """

    return (
        await asyncio_detailed(
            evaluator=evaluator,
            client=client,
            body=body,
        )
    ).parsed
