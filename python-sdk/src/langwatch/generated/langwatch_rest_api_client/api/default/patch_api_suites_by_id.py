from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_suites_by_id_body import PatchApiSuitesByIdBody
from ...models.patch_api_suites_by_id_response_200 import PatchApiSuitesByIdResponse200
from ...models.patch_api_suites_by_id_response_400 import PatchApiSuitesByIdResponse400
from ...models.patch_api_suites_by_id_response_401 import PatchApiSuitesByIdResponse401
from ...models.patch_api_suites_by_id_response_404 import PatchApiSuitesByIdResponse404
from ...models.patch_api_suites_by_id_response_422 import PatchApiSuitesByIdResponse422
from ...models.patch_api_suites_by_id_response_500 import PatchApiSuitesByIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    body: PatchApiSuitesByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/suites/{id}".format(
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
    PatchApiSuitesByIdResponse200
    | PatchApiSuitesByIdResponse400
    | PatchApiSuitesByIdResponse401
    | PatchApiSuitesByIdResponse404
    | PatchApiSuitesByIdResponse422
    | PatchApiSuitesByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiSuitesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiSuitesByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiSuitesByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PatchApiSuitesByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PatchApiSuitesByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PatchApiSuitesByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiSuitesByIdResponse200
    | PatchApiSuitesByIdResponse400
    | PatchApiSuitesByIdResponse401
    | PatchApiSuitesByIdResponse404
    | PatchApiSuitesByIdResponse422
    | PatchApiSuitesByIdResponse500
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
    body: PatchApiSuitesByIdBody | Unset = UNSET,
) -> Response[
    PatchApiSuitesByIdResponse200
    | PatchApiSuitesByIdResponse400
    | PatchApiSuitesByIdResponse401
    | PatchApiSuitesByIdResponse404
    | PatchApiSuitesByIdResponse422
    | PatchApiSuitesByIdResponse500
]:
    """Update a suite (run plan)

    Args:
        id (str):
        body (PatchApiSuitesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiSuitesByIdResponse200 | PatchApiSuitesByIdResponse400 | PatchApiSuitesByIdResponse401 | PatchApiSuitesByIdResponse404 | PatchApiSuitesByIdResponse422 | PatchApiSuitesByIdResponse500]
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
    body: PatchApiSuitesByIdBody | Unset = UNSET,
) -> (
    PatchApiSuitesByIdResponse200
    | PatchApiSuitesByIdResponse400
    | PatchApiSuitesByIdResponse401
    | PatchApiSuitesByIdResponse404
    | PatchApiSuitesByIdResponse422
    | PatchApiSuitesByIdResponse500
    | None
):
    """Update a suite (run plan)

    Args:
        id (str):
        body (PatchApiSuitesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiSuitesByIdResponse200 | PatchApiSuitesByIdResponse400 | PatchApiSuitesByIdResponse401 | PatchApiSuitesByIdResponse404 | PatchApiSuitesByIdResponse422 | PatchApiSuitesByIdResponse500
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
    body: PatchApiSuitesByIdBody | Unset = UNSET,
) -> Response[
    PatchApiSuitesByIdResponse200
    | PatchApiSuitesByIdResponse400
    | PatchApiSuitesByIdResponse401
    | PatchApiSuitesByIdResponse404
    | PatchApiSuitesByIdResponse422
    | PatchApiSuitesByIdResponse500
]:
    """Update a suite (run plan)

    Args:
        id (str):
        body (PatchApiSuitesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiSuitesByIdResponse200 | PatchApiSuitesByIdResponse400 | PatchApiSuitesByIdResponse401 | PatchApiSuitesByIdResponse404 | PatchApiSuitesByIdResponse422 | PatchApiSuitesByIdResponse500]
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
    body: PatchApiSuitesByIdBody | Unset = UNSET,
) -> (
    PatchApiSuitesByIdResponse200
    | PatchApiSuitesByIdResponse400
    | PatchApiSuitesByIdResponse401
    | PatchApiSuitesByIdResponse404
    | PatchApiSuitesByIdResponse422
    | PatchApiSuitesByIdResponse500
    | None
):
    """Update a suite (run plan)

    Args:
        id (str):
        body (PatchApiSuitesByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiSuitesByIdResponse200 | PatchApiSuitesByIdResponse400 | PatchApiSuitesByIdResponse401 | PatchApiSuitesByIdResponse404 | PatchApiSuitesByIdResponse422 | PatchApiSuitesByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
