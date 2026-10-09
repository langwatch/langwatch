from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dataset_evaluate_body import PostApiDatasetEvaluateBody
from ...models.post_api_dataset_evaluate_response_200_type_0 import PostApiDatasetEvaluateResponse200Type0
from ...models.post_api_dataset_evaluate_response_200_type_1 import PostApiDatasetEvaluateResponse200Type1
from ...models.post_api_dataset_evaluate_response_200_type_2 import PostApiDatasetEvaluateResponse200Type2
from ...models.post_api_dataset_evaluate_response_400 import PostApiDatasetEvaluateResponse400
from ...models.post_api_dataset_evaluate_response_401 import PostApiDatasetEvaluateResponse401
from ...models.post_api_dataset_evaluate_response_403 import PostApiDatasetEvaluateResponse403
from ...models.post_api_dataset_evaluate_response_404 import PostApiDatasetEvaluateResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiDatasetEvaluateBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/dataset/evaluate",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiDatasetEvaluateResponse200Type0
    | PostApiDatasetEvaluateResponse200Type1
    | PostApiDatasetEvaluateResponse200Type2
    | PostApiDatasetEvaluateResponse400
    | PostApiDatasetEvaluateResponse401
    | PostApiDatasetEvaluateResponse403
    | PostApiDatasetEvaluateResponse404
    | str
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            PostApiDatasetEvaluateResponse200Type0
            | PostApiDatasetEvaluateResponse200Type1
            | PostApiDatasetEvaluateResponse200Type2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = PostApiDatasetEvaluateResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_1 = PostApiDatasetEvaluateResponse200Type1.from_dict(data)

                return response_200_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_2 = PostApiDatasetEvaluateResponse200Type2.from_dict(data)

            return response_200_type_2

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiDatasetEvaluateResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiDatasetEvaluateResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiDatasetEvaluateResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiDatasetEvaluateResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 413:
        response_413 = response.text
        return response_413

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiDatasetEvaluateResponse200Type0
    | PostApiDatasetEvaluateResponse200Type1
    | PostApiDatasetEvaluateResponse200Type2
    | PostApiDatasetEvaluateResponse400
    | PostApiDatasetEvaluateResponse401
    | PostApiDatasetEvaluateResponse403
    | PostApiDatasetEvaluateResponse404
    | str
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
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetEvaluateBody,
) -> Response[
    PostApiDatasetEvaluateResponse200Type0
    | PostApiDatasetEvaluateResponse200Type1
    | PostApiDatasetEvaluateResponse200Type2
    | PostApiDatasetEvaluateResponse400
    | PostApiDatasetEvaluateResponse401
    | PostApiDatasetEvaluateResponse403
    | PostApiDatasetEvaluateResponse404
    | str
]:
    """Evaluate a dataset

     Run one evaluator across a saved dataset and record the result against an experiment. Name the
    dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under
    `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.

    Args:
        body (PostApiDatasetEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetEvaluateResponse200Type0 | PostApiDatasetEvaluateResponse200Type1 | PostApiDatasetEvaluateResponse200Type2 | PostApiDatasetEvaluateResponse400 | PostApiDatasetEvaluateResponse401 | PostApiDatasetEvaluateResponse403 | PostApiDatasetEvaluateResponse404 | str]
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
    client: AuthenticatedClient,
    body: PostApiDatasetEvaluateBody,
) -> (
    PostApiDatasetEvaluateResponse200Type0
    | PostApiDatasetEvaluateResponse200Type1
    | PostApiDatasetEvaluateResponse200Type2
    | PostApiDatasetEvaluateResponse400
    | PostApiDatasetEvaluateResponse401
    | PostApiDatasetEvaluateResponse403
    | PostApiDatasetEvaluateResponse404
    | str
    | None
):
    """Evaluate a dataset

     Run one evaluator across a saved dataset and record the result against an experiment. Name the
    dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under
    `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.

    Args:
        body (PostApiDatasetEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetEvaluateResponse200Type0 | PostApiDatasetEvaluateResponse200Type1 | PostApiDatasetEvaluateResponse200Type2 | PostApiDatasetEvaluateResponse400 | PostApiDatasetEvaluateResponse401 | PostApiDatasetEvaluateResponse403 | PostApiDatasetEvaluateResponse404 | str
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetEvaluateBody,
) -> Response[
    PostApiDatasetEvaluateResponse200Type0
    | PostApiDatasetEvaluateResponse200Type1
    | PostApiDatasetEvaluateResponse200Type2
    | PostApiDatasetEvaluateResponse400
    | PostApiDatasetEvaluateResponse401
    | PostApiDatasetEvaluateResponse403
    | PostApiDatasetEvaluateResponse404
    | str
]:
    """Evaluate a dataset

     Run one evaluator across a saved dataset and record the result against an experiment. Name the
    dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under
    `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.

    Args:
        body (PostApiDatasetEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiDatasetEvaluateResponse200Type0 | PostApiDatasetEvaluateResponse200Type1 | PostApiDatasetEvaluateResponse200Type2 | PostApiDatasetEvaluateResponse400 | PostApiDatasetEvaluateResponse401 | PostApiDatasetEvaluateResponse403 | PostApiDatasetEvaluateResponse404 | str]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiDatasetEvaluateBody,
) -> (
    PostApiDatasetEvaluateResponse200Type0
    | PostApiDatasetEvaluateResponse200Type1
    | PostApiDatasetEvaluateResponse200Type2
    | PostApiDatasetEvaluateResponse400
    | PostApiDatasetEvaluateResponse401
    | PostApiDatasetEvaluateResponse403
    | PostApiDatasetEvaluateResponse404
    | str
    | None
):
    """Evaluate a dataset

     Run one evaluator across a saved dataset and record the result against an experiment. Name the
    dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under
    `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.

    Args:
        body (PostApiDatasetEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiDatasetEvaluateResponse200Type0 | PostApiDatasetEvaluateResponse200Type1 | PostApiDatasetEvaluateResponse200Type2 | PostApiDatasetEvaluateResponse400 | PostApiDatasetEvaluateResponse401 | PostApiDatasetEvaluateResponse403 | PostApiDatasetEvaluateResponse404 | str
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
