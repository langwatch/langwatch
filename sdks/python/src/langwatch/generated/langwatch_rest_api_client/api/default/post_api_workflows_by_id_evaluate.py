from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_workflows_by_id_evaluate_body import PostApiWorkflowsByIdEvaluateBody
from ...models.post_api_workflows_by_id_evaluate_response_200 import PostApiWorkflowsByIdEvaluateResponse200
from ...models.post_api_workflows_by_id_evaluate_response_400 import PostApiWorkflowsByIdEvaluateResponse400
from ...models.post_api_workflows_by_id_evaluate_response_403 import PostApiWorkflowsByIdEvaluateResponse403
from ...models.post_api_workflows_by_id_evaluate_response_404 import PostApiWorkflowsByIdEvaluateResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PostApiWorkflowsByIdEvaluateBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/workflows/{id}/evaluate".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiWorkflowsByIdEvaluateResponse200
    | PostApiWorkflowsByIdEvaluateResponse400
    | PostApiWorkflowsByIdEvaluateResponse403
    | PostApiWorkflowsByIdEvaluateResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostApiWorkflowsByIdEvaluateResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiWorkflowsByIdEvaluateResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 403:
        response_403 = PostApiWorkflowsByIdEvaluateResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiWorkflowsByIdEvaluateResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiWorkflowsByIdEvaluateResponse200
    | PostApiWorkflowsByIdEvaluateResponse400
    | PostApiWorkflowsByIdEvaluateResponse403
    | PostApiWorkflowsByIdEvaluateResponse404
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
    id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiWorkflowsByIdEvaluateBody,
) -> Response[
    PostApiWorkflowsByIdEvaluateResponse200
    | PostApiWorkflowsByIdEvaluateResponse400
    | PostApiWorkflowsByIdEvaluateResponse403
    | PostApiWorkflowsByIdEvaluateResponse404
]:
    """Trigger an evaluation run of a workflow's committed version through the evaluations pipeline.
    Evaluate the workflow's attached dataset, inline data, or a platform dataset id; parameters bind as
    constant entry inputs on every row. Returns a run id and a results URL to poll or open in the
    browser.

    Args:
        id (str):
        body (PostApiWorkflowsByIdEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWorkflowsByIdEvaluateResponse200 | PostApiWorkflowsByIdEvaluateResponse400 | PostApiWorkflowsByIdEvaluateResponse403 | PostApiWorkflowsByIdEvaluateResponse404]
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
    client: AuthenticatedClient,
    body: PostApiWorkflowsByIdEvaluateBody,
) -> (
    PostApiWorkflowsByIdEvaluateResponse200
    | PostApiWorkflowsByIdEvaluateResponse400
    | PostApiWorkflowsByIdEvaluateResponse403
    | PostApiWorkflowsByIdEvaluateResponse404
    | None
):
    """Trigger an evaluation run of a workflow's committed version through the evaluations pipeline.
    Evaluate the workflow's attached dataset, inline data, or a platform dataset id; parameters bind as
    constant entry inputs on every row. Returns a run id and a results URL to poll or open in the
    browser.

    Args:
        id (str):
        body (PostApiWorkflowsByIdEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWorkflowsByIdEvaluateResponse200 | PostApiWorkflowsByIdEvaluateResponse400 | PostApiWorkflowsByIdEvaluateResponse403 | PostApiWorkflowsByIdEvaluateResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiWorkflowsByIdEvaluateBody,
) -> Response[
    PostApiWorkflowsByIdEvaluateResponse200
    | PostApiWorkflowsByIdEvaluateResponse400
    | PostApiWorkflowsByIdEvaluateResponse403
    | PostApiWorkflowsByIdEvaluateResponse404
]:
    """Trigger an evaluation run of a workflow's committed version through the evaluations pipeline.
    Evaluate the workflow's attached dataset, inline data, or a platform dataset id; parameters bind as
    constant entry inputs on every row. Returns a run id and a results URL to poll or open in the
    browser.

    Args:
        id (str):
        body (PostApiWorkflowsByIdEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiWorkflowsByIdEvaluateResponse200 | PostApiWorkflowsByIdEvaluateResponse400 | PostApiWorkflowsByIdEvaluateResponse403 | PostApiWorkflowsByIdEvaluateResponse404]
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
    client: AuthenticatedClient,
    body: PostApiWorkflowsByIdEvaluateBody,
) -> (
    PostApiWorkflowsByIdEvaluateResponse200
    | PostApiWorkflowsByIdEvaluateResponse400
    | PostApiWorkflowsByIdEvaluateResponse403
    | PostApiWorkflowsByIdEvaluateResponse404
    | None
):
    """Trigger an evaluation run of a workflow's committed version through the evaluations pipeline.
    Evaluate the workflow's attached dataset, inline data, or a platform dataset id; parameters bind as
    constant entry inputs on every row. Returns a run id and a results URL to poll or open in the
    browser.

    Args:
        id (str):
        body (PostApiWorkflowsByIdEvaluateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiWorkflowsByIdEvaluateResponse200 | PostApiWorkflowsByIdEvaluateResponse400 | PostApiWorkflowsByIdEvaluateResponse403 | PostApiWorkflowsByIdEvaluateResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
