from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_evaluations_batch_log_results_body import PostApiEvaluationsBatchLogResultsBody
from ...models.post_api_evaluations_batch_log_results_response_200 import PostApiEvaluationsBatchLogResultsResponse200
from ...models.post_api_evaluations_batch_log_results_response_400 import PostApiEvaluationsBatchLogResultsResponse400
from ...models.post_api_evaluations_batch_log_results_response_401 import PostApiEvaluationsBatchLogResultsResponse401
from ...models.post_api_evaluations_batch_log_results_response_403 import PostApiEvaluationsBatchLogResultsResponse403
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiEvaluationsBatchLogResultsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/evaluations/batch/log_results",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiEvaluationsBatchLogResultsResponse200
    | PostApiEvaluationsBatchLogResultsResponse400
    | PostApiEvaluationsBatchLogResultsResponse401
    | PostApiEvaluationsBatchLogResultsResponse403
    | None
):
    if response.status_code == 200:
        response_200 = PostApiEvaluationsBatchLogResultsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiEvaluationsBatchLogResultsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiEvaluationsBatchLogResultsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiEvaluationsBatchLogResultsResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiEvaluationsBatchLogResultsResponse200
    | PostApiEvaluationsBatchLogResultsResponse400
    | PostApiEvaluationsBatchLogResultsResponse401
    | PostApiEvaluationsBatchLogResultsResponse403
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
    body: PostApiEvaluationsBatchLogResultsBody,
) -> Response[
    PostApiEvaluationsBatchLogResultsResponse200
    | PostApiEvaluationsBatchLogResultsResponse400
    | PostApiEvaluationsBatchLogResultsResponse401
    | PostApiEvaluationsBatchLogResultsResponse403
]:
    """Report batch evaluation results

     Report the rows of a batch evaluation against an experiment, so its scores and progress show up in
    the app. This is the second half of an SDK batch evaluation: create the experiment with `POST
    /api/experiment/init`, then post rows here as they finish. Identify the experiment by either
    `experiment_id` or `experiment_slug`. Bodies up to 20MB are accepted.

    Args:
        body (PostApiEvaluationsBatchLogResultsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEvaluationsBatchLogResultsResponse200 | PostApiEvaluationsBatchLogResultsResponse400 | PostApiEvaluationsBatchLogResultsResponse401 | PostApiEvaluationsBatchLogResultsResponse403]
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
    body: PostApiEvaluationsBatchLogResultsBody,
) -> (
    PostApiEvaluationsBatchLogResultsResponse200
    | PostApiEvaluationsBatchLogResultsResponse400
    | PostApiEvaluationsBatchLogResultsResponse401
    | PostApiEvaluationsBatchLogResultsResponse403
    | None
):
    """Report batch evaluation results

     Report the rows of a batch evaluation against an experiment, so its scores and progress show up in
    the app. This is the second half of an SDK batch evaluation: create the experiment with `POST
    /api/experiment/init`, then post rows here as they finish. Identify the experiment by either
    `experiment_id` or `experiment_slug`. Bodies up to 20MB are accepted.

    Args:
        body (PostApiEvaluationsBatchLogResultsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEvaluationsBatchLogResultsResponse200 | PostApiEvaluationsBatchLogResultsResponse400 | PostApiEvaluationsBatchLogResultsResponse401 | PostApiEvaluationsBatchLogResultsResponse403
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiEvaluationsBatchLogResultsBody,
) -> Response[
    PostApiEvaluationsBatchLogResultsResponse200
    | PostApiEvaluationsBatchLogResultsResponse400
    | PostApiEvaluationsBatchLogResultsResponse401
    | PostApiEvaluationsBatchLogResultsResponse403
]:
    """Report batch evaluation results

     Report the rows of a batch evaluation against an experiment, so its scores and progress show up in
    the app. This is the second half of an SDK batch evaluation: create the experiment with `POST
    /api/experiment/init`, then post rows here as they finish. Identify the experiment by either
    `experiment_id` or `experiment_slug`. Bodies up to 20MB are accepted.

    Args:
        body (PostApiEvaluationsBatchLogResultsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiEvaluationsBatchLogResultsResponse200 | PostApiEvaluationsBatchLogResultsResponse400 | PostApiEvaluationsBatchLogResultsResponse401 | PostApiEvaluationsBatchLogResultsResponse403]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiEvaluationsBatchLogResultsBody,
) -> (
    PostApiEvaluationsBatchLogResultsResponse200
    | PostApiEvaluationsBatchLogResultsResponse400
    | PostApiEvaluationsBatchLogResultsResponse401
    | PostApiEvaluationsBatchLogResultsResponse403
    | None
):
    """Report batch evaluation results

     Report the rows of a batch evaluation against an experiment, so its scores and progress show up in
    the app. This is the second half of an SDK batch evaluation: create the experiment with `POST
    /api/experiment/init`, then post rows here as they finish. Identify the experiment by either
    `experiment_id` or `experiment_slug`. Bodies up to 20MB are accepted.

    Args:
        body (PostApiEvaluationsBatchLogResultsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiEvaluationsBatchLogResultsResponse200 | PostApiEvaluationsBatchLogResultsResponse400 | PostApiEvaluationsBatchLogResultsResponse401 | PostApiEvaluationsBatchLogResultsResponse403
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
