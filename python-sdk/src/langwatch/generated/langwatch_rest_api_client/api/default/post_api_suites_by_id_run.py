from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_suites_by_id_run_body import PostApiSuitesByIdRunBody
from ...models.post_api_suites_by_id_run_response_200 import PostApiSuitesByIdRunResponse200
from ...models.post_api_suites_by_id_run_response_400 import PostApiSuitesByIdRunResponse400
from ...models.post_api_suites_by_id_run_response_401 import PostApiSuitesByIdRunResponse401
from ...models.post_api_suites_by_id_run_response_404 import PostApiSuitesByIdRunResponse404
from ...models.post_api_suites_by_id_run_response_422 import PostApiSuitesByIdRunResponse422
from ...models.post_api_suites_by_id_run_response_500 import PostApiSuitesByIdRunResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PostApiSuitesByIdRunBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/suites/{id}/run".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiSuitesByIdRunResponse200
    | PostApiSuitesByIdRunResponse400
    | PostApiSuitesByIdRunResponse401
    | PostApiSuitesByIdRunResponse404
    | PostApiSuitesByIdRunResponse422
    | PostApiSuitesByIdRunResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiSuitesByIdRunResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiSuitesByIdRunResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiSuitesByIdRunResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiSuitesByIdRunResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PostApiSuitesByIdRunResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiSuitesByIdRunResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiSuitesByIdRunResponse200
    | PostApiSuitesByIdRunResponse400
    | PostApiSuitesByIdRunResponse401
    | PostApiSuitesByIdRunResponse404
    | PostApiSuitesByIdRunResponse422
    | PostApiSuitesByIdRunResponse500
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
    client: AuthenticatedClient | Client,
    body: PostApiSuitesByIdRunBody | Unset = UNSET,
) -> Response[
    PostApiSuitesByIdRunResponse200
    | PostApiSuitesByIdRunResponse400
    | PostApiSuitesByIdRunResponse401
    | PostApiSuitesByIdRunResponse404
    | PostApiSuitesByIdRunResponse422
    | PostApiSuitesByIdRunResponse500
]:
    """Trigger a suite run. Schedules scenario executions for all active scenarios × targets × repeatCount.

    Args:
        id (str):
        body (PostApiSuitesByIdRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiSuitesByIdRunResponse200 | PostApiSuitesByIdRunResponse400 | PostApiSuitesByIdRunResponse401 | PostApiSuitesByIdRunResponse404 | PostApiSuitesByIdRunResponse422 | PostApiSuitesByIdRunResponse500]
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
    client: AuthenticatedClient | Client,
    body: PostApiSuitesByIdRunBody | Unset = UNSET,
) -> (
    PostApiSuitesByIdRunResponse200
    | PostApiSuitesByIdRunResponse400
    | PostApiSuitesByIdRunResponse401
    | PostApiSuitesByIdRunResponse404
    | PostApiSuitesByIdRunResponse422
    | PostApiSuitesByIdRunResponse500
    | None
):
    """Trigger a suite run. Schedules scenario executions for all active scenarios × targets × repeatCount.

    Args:
        id (str):
        body (PostApiSuitesByIdRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiSuitesByIdRunResponse200 | PostApiSuitesByIdRunResponse400 | PostApiSuitesByIdRunResponse401 | PostApiSuitesByIdRunResponse404 | PostApiSuitesByIdRunResponse422 | PostApiSuitesByIdRunResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PostApiSuitesByIdRunBody | Unset = UNSET,
) -> Response[
    PostApiSuitesByIdRunResponse200
    | PostApiSuitesByIdRunResponse400
    | PostApiSuitesByIdRunResponse401
    | PostApiSuitesByIdRunResponse404
    | PostApiSuitesByIdRunResponse422
    | PostApiSuitesByIdRunResponse500
]:
    """Trigger a suite run. Schedules scenario executions for all active scenarios × targets × repeatCount.

    Args:
        id (str):
        body (PostApiSuitesByIdRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiSuitesByIdRunResponse200 | PostApiSuitesByIdRunResponse400 | PostApiSuitesByIdRunResponse401 | PostApiSuitesByIdRunResponse404 | PostApiSuitesByIdRunResponse422 | PostApiSuitesByIdRunResponse500]
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
    client: AuthenticatedClient | Client,
    body: PostApiSuitesByIdRunBody | Unset = UNSET,
) -> (
    PostApiSuitesByIdRunResponse200
    | PostApiSuitesByIdRunResponse400
    | PostApiSuitesByIdRunResponse401
    | PostApiSuitesByIdRunResponse404
    | PostApiSuitesByIdRunResponse422
    | PostApiSuitesByIdRunResponse500
    | None
):
    """Trigger a suite run. Schedules scenario executions for all active scenarios × targets × repeatCount.

    Args:
        id (str):
        body (PostApiSuitesByIdRunBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiSuitesByIdRunResponse200 | PostApiSuitesByIdRunResponse400 | PostApiSuitesByIdRunResponse401 | PostApiSuitesByIdRunResponse404 | PostApiSuitesByIdRunResponse422 | PostApiSuitesByIdRunResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
