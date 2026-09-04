from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_evaluations_by_evaluator_evaluate_body import PostApiEvaluationsByEvaluatorEvaluateBody
from ...models.post_api_evaluations_by_evaluator_evaluate_response_200_type_0 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_200_type_1 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type1,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_200_type_2 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type2,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_400 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse400,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_401 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse401,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_403 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse403,
)
from ...models.post_api_evaluations_by_evaluator_evaluate_response_404 import (
    PostApiEvaluationsByEvaluatorEvaluateResponse404,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    evaluator: str,
    *,
    body: PostApiEvaluationsByEvaluatorEvaluateBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/evaluations/{evaluator}/evaluate".format(
            evaluator=quote(str(evaluator), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
    | PostApiEvaluationsByEvaluatorEvaluateResponse400
    | PostApiEvaluationsByEvaluatorEvaluateResponse401
    | PostApiEvaluationsByEvaluatorEvaluateResponse403
    | PostApiEvaluationsByEvaluatorEvaluateResponse404
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
            | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
            | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = PostApiEvaluationsByEvaluatorEvaluateResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_1 = PostApiEvaluationsByEvaluatorEvaluateResponse200Type1.from_dict(data)

                return response_200_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_2 = PostApiEvaluationsByEvaluatorEvaluateResponse200Type2.from_dict(data)

            return response_200_type_2

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiEvaluationsByEvaluatorEvaluateResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiEvaluationsByEvaluatorEvaluateResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiEvaluationsByEvaluatorEvaluateResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiEvaluationsByEvaluatorEvaluateResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
    | PostApiEvaluationsByEvaluatorEvaluateResponse400
    | PostApiEvaluationsByEvaluatorEvaluateResponse401
    | PostApiEvaluationsByEvaluatorEvaluateResponse403
    | PostApiEvaluationsByEvaluatorEvaluateResponse404
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
    evaluator: str,
    *,
    client: AuthenticatedClient,
    body: PostApiEvaluationsByEvaluatorEvaluateBody,
) -> Response[
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
    | PostApiEvaluationsByEvaluatorEvaluateResponse400
    | PostApiEvaluationsByEvaluatorEvaluateResponse401
    | PostApiEvaluationsByEvaluatorEvaluateResponse403
    | PostApiEvaluationsByEvaluatorEvaluateResponse404
]:
    """Run an evaluator

     Run one evaluator over a single input and get its score back. Built-in evaluators whose id has two
    segments, such as `ragas/faithfulness`, are addressed with the two-segment form of this path. Bodies
    up to 30MB are accepted.

    Args:
        evaluator (str):
        body (PostApiEvaluationsByEvaluatorEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEvaluationsByEvaluatorEvaluateResponse200Type0 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2 | PostApiEvaluationsByEvaluatorEvaluateResponse400 | PostApiEvaluationsByEvaluatorEvaluateResponse401 | PostApiEvaluationsByEvaluatorEvaluateResponse403 | PostApiEvaluationsByEvaluatorEvaluateResponse404]
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
    client: AuthenticatedClient,
    body: PostApiEvaluationsByEvaluatorEvaluateBody,
) -> (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
    | PostApiEvaluationsByEvaluatorEvaluateResponse400
    | PostApiEvaluationsByEvaluatorEvaluateResponse401
    | PostApiEvaluationsByEvaluatorEvaluateResponse403
    | PostApiEvaluationsByEvaluatorEvaluateResponse404
    | None
):
    """Run an evaluator

     Run one evaluator over a single input and get its score back. Built-in evaluators whose id has two
    segments, such as `ragas/faithfulness`, are addressed with the two-segment form of this path. Bodies
    up to 30MB are accepted.

    Args:
        evaluator (str):
        body (PostApiEvaluationsByEvaluatorEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEvaluationsByEvaluatorEvaluateResponse200Type0 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2 | PostApiEvaluationsByEvaluatorEvaluateResponse400 | PostApiEvaluationsByEvaluatorEvaluateResponse401 | PostApiEvaluationsByEvaluatorEvaluateResponse403 | PostApiEvaluationsByEvaluatorEvaluateResponse404
    """

    return sync_detailed(
        evaluator=evaluator,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    evaluator: str,
    *,
    client: AuthenticatedClient,
    body: PostApiEvaluationsByEvaluatorEvaluateBody,
) -> Response[
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
    | PostApiEvaluationsByEvaluatorEvaluateResponse400
    | PostApiEvaluationsByEvaluatorEvaluateResponse401
    | PostApiEvaluationsByEvaluatorEvaluateResponse403
    | PostApiEvaluationsByEvaluatorEvaluateResponse404
]:
    """Run an evaluator

     Run one evaluator over a single input and get its score back. Built-in evaluators whose id has two
    segments, such as `ragas/faithfulness`, are addressed with the two-segment form of this path. Bodies
    up to 30MB are accepted.

    Args:
        evaluator (str):
        body (PostApiEvaluationsByEvaluatorEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEvaluationsByEvaluatorEvaluateResponse200Type0 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2 | PostApiEvaluationsByEvaluatorEvaluateResponse400 | PostApiEvaluationsByEvaluatorEvaluateResponse401 | PostApiEvaluationsByEvaluatorEvaluateResponse403 | PostApiEvaluationsByEvaluatorEvaluateResponse404]
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
    client: AuthenticatedClient,
    body: PostApiEvaluationsByEvaluatorEvaluateBody,
) -> (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Type0
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1
    | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2
    | PostApiEvaluationsByEvaluatorEvaluateResponse400
    | PostApiEvaluationsByEvaluatorEvaluateResponse401
    | PostApiEvaluationsByEvaluatorEvaluateResponse403
    | PostApiEvaluationsByEvaluatorEvaluateResponse404
    | None
):
    """Run an evaluator

     Run one evaluator over a single input and get its score back. Built-in evaluators whose id has two
    segments, such as `ragas/faithfulness`, are addressed with the two-segment form of this path. Bodies
    up to 30MB are accepted.

    Args:
        evaluator (str):
        body (PostApiEvaluationsByEvaluatorEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEvaluationsByEvaluatorEvaluateResponse200Type0 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type1 | PostApiEvaluationsByEvaluatorEvaluateResponse200Type2 | PostApiEvaluationsByEvaluatorEvaluateResponse400 | PostApiEvaluationsByEvaluatorEvaluateResponse401 | PostApiEvaluationsByEvaluatorEvaluateResponse403 | PostApiEvaluationsByEvaluatorEvaluateResponse404
    """

    return (
        await asyncio_detailed(
            evaluator=evaluator,
            client=client,
            body=body,
        )
    ).parsed
