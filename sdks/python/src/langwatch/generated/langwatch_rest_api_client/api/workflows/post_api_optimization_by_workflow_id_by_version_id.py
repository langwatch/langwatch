from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_optimization_by_workflow_id_by_version_id_body import (
    PostApiOptimizationByWorkflowIdByVersionIdBody,
)
from ...models.post_api_optimization_by_workflow_id_by_version_id_response_200 import (
    PostApiOptimizationByWorkflowIdByVersionIdResponse200,
)
from ...models.post_api_optimization_by_workflow_id_by_version_id_response_400 import (
    PostApiOptimizationByWorkflowIdByVersionIdResponse400,
)
from ...models.post_api_optimization_by_workflow_id_by_version_id_response_401 import (
    PostApiOptimizationByWorkflowIdByVersionIdResponse401,
)
from ...models.post_api_optimization_by_workflow_id_by_version_id_response_403 import (
    PostApiOptimizationByWorkflowIdByVersionIdResponse403,
)
from ...models.post_api_optimization_by_workflow_id_by_version_id_response_404 import (
    PostApiOptimizationByWorkflowIdByVersionIdResponse404,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    workflow_id: str,
    version_id: str,
    *,
    body: PostApiOptimizationByWorkflowIdByVersionIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/optimization/{workflow_id}/{version_id}".format(
            workflow_id=quote(str(workflow_id), safe=""),
            version_id=quote(str(version_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiOptimizationByWorkflowIdByVersionIdResponse200
    | PostApiOptimizationByWorkflowIdByVersionIdResponse400
    | PostApiOptimizationByWorkflowIdByVersionIdResponse401
    | PostApiOptimizationByWorkflowIdByVersionIdResponse403
    | PostApiOptimizationByWorkflowIdByVersionIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostApiOptimizationByWorkflowIdByVersionIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiOptimizationByWorkflowIdByVersionIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiOptimizationByWorkflowIdByVersionIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiOptimizationByWorkflowIdByVersionIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PostApiOptimizationByWorkflowIdByVersionIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiOptimizationByWorkflowIdByVersionIdResponse200
    | PostApiOptimizationByWorkflowIdByVersionIdResponse400
    | PostApiOptimizationByWorkflowIdByVersionIdResponse401
    | PostApiOptimizationByWorkflowIdByVersionIdResponse403
    | PostApiOptimizationByWorkflowIdByVersionIdResponse404
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
    workflow_id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiOptimizationByWorkflowIdByVersionIdBody,
) -> Response[
    PostApiOptimizationByWorkflowIdByVersionIdResponse200
    | PostApiOptimizationByWorkflowIdByVersionIdResponse400
    | PostApiOptimizationByWorkflowIdByVersionIdResponse401
    | PostApiOptimizationByWorkflowIdByVersionIdResponse403
    | PostApiOptimizationByWorkflowIdByVersionIdResponse404
]:
    """Run a workflow version (legacy path)

     Run one pinned version of an Optimization Studio workflow synchronously. Identical to `POST
    /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new integrations; this one
    stays for callers written against it.

    Args:
        workflow_id (str):
        version_id (str):
        body (PostApiOptimizationByWorkflowIdByVersionIdBody): The workflow's input fields, named
            as the workflow's entry node names them

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiOptimizationByWorkflowIdByVersionIdResponse200 | PostApiOptimizationByWorkflowIdByVersionIdResponse400 | PostApiOptimizationByWorkflowIdByVersionIdResponse401 | PostApiOptimizationByWorkflowIdByVersionIdResponse403 | PostApiOptimizationByWorkflowIdByVersionIdResponse404]
    """

    kwargs = _get_kwargs(
        workflow_id=workflow_id,
        version_id=version_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    workflow_id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiOptimizationByWorkflowIdByVersionIdBody,
) -> (
    PostApiOptimizationByWorkflowIdByVersionIdResponse200
    | PostApiOptimizationByWorkflowIdByVersionIdResponse400
    | PostApiOptimizationByWorkflowIdByVersionIdResponse401
    | PostApiOptimizationByWorkflowIdByVersionIdResponse403
    | PostApiOptimizationByWorkflowIdByVersionIdResponse404
    | None
):
    """Run a workflow version (legacy path)

     Run one pinned version of an Optimization Studio workflow synchronously. Identical to `POST
    /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new integrations; this one
    stays for callers written against it.

    Args:
        workflow_id (str):
        version_id (str):
        body (PostApiOptimizationByWorkflowIdByVersionIdBody): The workflow's input fields, named
            as the workflow's entry node names them

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiOptimizationByWorkflowIdByVersionIdResponse200 | PostApiOptimizationByWorkflowIdByVersionIdResponse400 | PostApiOptimizationByWorkflowIdByVersionIdResponse401 | PostApiOptimizationByWorkflowIdByVersionIdResponse403 | PostApiOptimizationByWorkflowIdByVersionIdResponse404
    """

    return sync_detailed(
        workflow_id=workflow_id,
        version_id=version_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    workflow_id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiOptimizationByWorkflowIdByVersionIdBody,
) -> Response[
    PostApiOptimizationByWorkflowIdByVersionIdResponse200
    | PostApiOptimizationByWorkflowIdByVersionIdResponse400
    | PostApiOptimizationByWorkflowIdByVersionIdResponse401
    | PostApiOptimizationByWorkflowIdByVersionIdResponse403
    | PostApiOptimizationByWorkflowIdByVersionIdResponse404
]:
    """Run a workflow version (legacy path)

     Run one pinned version of an Optimization Studio workflow synchronously. Identical to `POST
    /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new integrations; this one
    stays for callers written against it.

    Args:
        workflow_id (str):
        version_id (str):
        body (PostApiOptimizationByWorkflowIdByVersionIdBody): The workflow's input fields, named
            as the workflow's entry node names them

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiOptimizationByWorkflowIdByVersionIdResponse200 | PostApiOptimizationByWorkflowIdByVersionIdResponse400 | PostApiOptimizationByWorkflowIdByVersionIdResponse401 | PostApiOptimizationByWorkflowIdByVersionIdResponse403 | PostApiOptimizationByWorkflowIdByVersionIdResponse404]
    """

    kwargs = _get_kwargs(
        workflow_id=workflow_id,
        version_id=version_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    workflow_id: str,
    version_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiOptimizationByWorkflowIdByVersionIdBody,
) -> (
    PostApiOptimizationByWorkflowIdByVersionIdResponse200
    | PostApiOptimizationByWorkflowIdByVersionIdResponse400
    | PostApiOptimizationByWorkflowIdByVersionIdResponse401
    | PostApiOptimizationByWorkflowIdByVersionIdResponse403
    | PostApiOptimizationByWorkflowIdByVersionIdResponse404
    | None
):
    """Run a workflow version (legacy path)

     Run one pinned version of an Optimization Studio workflow synchronously. Identical to `POST
    /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new integrations; this one
    stays for callers written against it.

    Args:
        workflow_id (str):
        version_id (str):
        body (PostApiOptimizationByWorkflowIdByVersionIdBody): The workflow's input fields, named
            as the workflow's entry node names them

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiOptimizationByWorkflowIdByVersionIdResponse200 | PostApiOptimizationByWorkflowIdByVersionIdResponse400 | PostApiOptimizationByWorkflowIdByVersionIdResponse401 | PostApiOptimizationByWorkflowIdByVersionIdResponse403 | PostApiOptimizationByWorkflowIdByVersionIdResponse404
    """

    return (
        await asyncio_detailed(
            workflow_id=workflow_id,
            version_id=version_id,
            client=client,
            body=body,
        )
    ).parsed
