from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.patch_api_annotations_id_body import PatchApiAnnotationsIdBody
from ...models.patch_api_annotations_id_response_200 import PatchApiAnnotationsIdResponse200
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: PatchApiAnnotationsIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": f"/api/annotations/{id}",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, PatchApiAnnotationsIdResponse200]]:
    if response.status_code == 200:
        response_200 = PatchApiAnnotationsIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[Error, PatchApiAnnotationsIdResponse200]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PatchApiAnnotationsIdBody,
) -> Response[Union[Error, PatchApiAnnotationsIdResponse200]]:
    """Updates a single annotation based on the ID supplied

    Args:
        id (str):
        body (PatchApiAnnotationsIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, PatchApiAnnotationsIdResponse200]]
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
    client: Union[AuthenticatedClient, Client],
    body: PatchApiAnnotationsIdBody,
) -> Optional[Union[Error, PatchApiAnnotationsIdResponse200]]:
    """Updates a single annotation based on the ID supplied

    Args:
        id (str):
        body (PatchApiAnnotationsIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, PatchApiAnnotationsIdResponse200]
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PatchApiAnnotationsIdBody,
) -> Response[Union[Error, PatchApiAnnotationsIdResponse200]]:
    """Updates a single annotation based on the ID supplied

    Args:
        id (str):
        body (PatchApiAnnotationsIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, PatchApiAnnotationsIdResponse200]]
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
    client: Union[AuthenticatedClient, Client],
    body: PatchApiAnnotationsIdBody,
) -> Optional[Union[Error, PatchApiAnnotationsIdResponse200]]:
    """Updates a single annotation based on the ID supplied

    Args:
        id (str):
        body (PatchApiAnnotationsIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, PatchApiAnnotationsIdResponse200]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
