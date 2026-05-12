from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_workflows_by_id_body import PatchApiWorkflowsByIdBody
from ...models.patch_api_workflows_by_id_response_200 import PatchApiWorkflowsByIdResponse200
from ...models.patch_api_workflows_by_id_response_400 import PatchApiWorkflowsByIdResponse400
from ...models.patch_api_workflows_by_id_response_401 import PatchApiWorkflowsByIdResponse401
from ...models.patch_api_workflows_by_id_response_404 import PatchApiWorkflowsByIdResponse404
from ...models.patch_api_workflows_by_id_response_422 import PatchApiWorkflowsByIdResponse422
from ...models.patch_api_workflows_by_id_response_500 import PatchApiWorkflowsByIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PatchApiWorkflowsByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/workflows/{id}".format(
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
    PatchApiWorkflowsByIdResponse200
    | PatchApiWorkflowsByIdResponse400
    | PatchApiWorkflowsByIdResponse401
    | PatchApiWorkflowsByIdResponse404
    | PatchApiWorkflowsByIdResponse422
    | PatchApiWorkflowsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiWorkflowsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiWorkflowsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiWorkflowsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PatchApiWorkflowsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PatchApiWorkflowsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiWorkflowsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiWorkflowsByIdResponse200
    | PatchApiWorkflowsByIdResponse400
    | PatchApiWorkflowsByIdResponse401
    | PatchApiWorkflowsByIdResponse404
    | PatchApiWorkflowsByIdResponse422
    | PatchApiWorkflowsByIdResponse500
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
    body: PatchApiWorkflowsByIdBody | Unset = UNSET,
) -> Response[
    PatchApiWorkflowsByIdResponse200
    | PatchApiWorkflowsByIdResponse400
    | PatchApiWorkflowsByIdResponse401
    | PatchApiWorkflowsByIdResponse404
    | PatchApiWorkflowsByIdResponse422
    | PatchApiWorkflowsByIdResponse500
]:
    """Update a workflow's metadata (name, icon, description)

    Args:
        id (str):
        body (PatchApiWorkflowsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiWorkflowsByIdResponse200 | PatchApiWorkflowsByIdResponse400 | PatchApiWorkflowsByIdResponse401 | PatchApiWorkflowsByIdResponse404 | PatchApiWorkflowsByIdResponse422 | PatchApiWorkflowsByIdResponse500]
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
    body: PatchApiWorkflowsByIdBody | Unset = UNSET,
) -> (
    PatchApiWorkflowsByIdResponse200
    | PatchApiWorkflowsByIdResponse400
    | PatchApiWorkflowsByIdResponse401
    | PatchApiWorkflowsByIdResponse404
    | PatchApiWorkflowsByIdResponse422
    | PatchApiWorkflowsByIdResponse500
    | None
):
    """Update a workflow's metadata (name, icon, description)

    Args:
        id (str):
        body (PatchApiWorkflowsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiWorkflowsByIdResponse200 | PatchApiWorkflowsByIdResponse400 | PatchApiWorkflowsByIdResponse401 | PatchApiWorkflowsByIdResponse404 | PatchApiWorkflowsByIdResponse422 | PatchApiWorkflowsByIdResponse500
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
    body: PatchApiWorkflowsByIdBody | Unset = UNSET,
) -> Response[
    PatchApiWorkflowsByIdResponse200
    | PatchApiWorkflowsByIdResponse400
    | PatchApiWorkflowsByIdResponse401
    | PatchApiWorkflowsByIdResponse404
    | PatchApiWorkflowsByIdResponse422
    | PatchApiWorkflowsByIdResponse500
]:
    """Update a workflow's metadata (name, icon, description)

    Args:
        id (str):
        body (PatchApiWorkflowsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiWorkflowsByIdResponse200 | PatchApiWorkflowsByIdResponse400 | PatchApiWorkflowsByIdResponse401 | PatchApiWorkflowsByIdResponse404 | PatchApiWorkflowsByIdResponse422 | PatchApiWorkflowsByIdResponse500]
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
    body: PatchApiWorkflowsByIdBody | Unset = UNSET,
) -> (
    PatchApiWorkflowsByIdResponse200
    | PatchApiWorkflowsByIdResponse400
    | PatchApiWorkflowsByIdResponse401
    | PatchApiWorkflowsByIdResponse404
    | PatchApiWorkflowsByIdResponse422
    | PatchApiWorkflowsByIdResponse500
    | None
):
    """Update a workflow's metadata (name, icon, description)

    Args:
        id (str):
        body (PatchApiWorkflowsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiWorkflowsByIdResponse200 | PatchApiWorkflowsByIdResponse400 | PatchApiWorkflowsByIdResponse401 | PatchApiWorkflowsByIdResponse404 | PatchApiWorkflowsByIdResponse422 | PatchApiWorkflowsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
