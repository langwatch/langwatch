from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200 import (
    PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
)
from ...models.post_api_evaluations_by_evaluator_by_subpath_evaluate_response_400 import (
    PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
)
from ...models.post_api_evaluations_by_evaluator_by_subpath_evaluate_response_401 import (
    PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
)
from ...models.post_api_evaluations_by_evaluator_by_subpath_evaluate_response_500 import (
    PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
)
from ...types import Response


def _get_kwargs(
    evaluator: str,
    subpath: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/evaluations/{evaluator}/{subpath}/evaluate",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 500:
        response_500 = PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
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
    subpath: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
    ]
]:
    """Run evaluation with evaluator and subpath (legacy route)

    Args:
        evaluator (str):
        subpath (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500]]
    """

    kwargs = _get_kwargs(
        evaluator=evaluator,
        subpath=subpath,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    evaluator: str,
    subpath: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
    ]
]:
    """Run evaluation with evaluator and subpath (legacy route)

    Args:
        evaluator (str):
        subpath (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500]
    """

    return sync_detailed(
        evaluator=evaluator,
        subpath=subpath,
        client=client,
    ).parsed


async def asyncio_detailed(
    evaluator: str,
    subpath: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
    ]
]:
    """Run evaluation with evaluator and subpath (legacy route)

    Args:
        evaluator (str):
        subpath (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500]]
    """

    kwargs = _get_kwargs(
        evaluator=evaluator,
        subpath=subpath,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    evaluator: str,
    subpath: str,
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401,
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500,
    ]
]:
    """Run evaluation with evaluator and subpath (legacy route)

    Args:
        evaluator (str):
        subpath (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse400, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse401, PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse500]
    """

    return (
        await asyncio_detailed(
            evaluator=evaluator,
            subpath=subpath,
            client=client,
        )
    ).parsed
