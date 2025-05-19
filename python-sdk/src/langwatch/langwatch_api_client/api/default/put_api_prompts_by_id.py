from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_prompts_by_id_body import PutApiPromptsByIdBody
from ...models.put_api_prompts_by_id_response_200 import PutApiPromptsByIdResponse200
from ...models.put_api_prompts_by_id_response_400 import PutApiPromptsByIdResponse400
from ...models.put_api_prompts_by_id_response_401 import PutApiPromptsByIdResponse401
from ...models.put_api_prompts_by_id_response_404 import PutApiPromptsByIdResponse404
from ...models.put_api_prompts_by_id_response_500 import PutApiPromptsByIdResponse500
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: PutApiPromptsByIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": f"/api/prompts/{id}",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        PutApiPromptsByIdResponse200,
        PutApiPromptsByIdResponse400,
        PutApiPromptsByIdResponse401,
        PutApiPromptsByIdResponse404,
        PutApiPromptsByIdResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = PutApiPromptsByIdResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = PutApiPromptsByIdResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = PutApiPromptsByIdResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = PutApiPromptsByIdResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 500:
        response_500 = PutApiPromptsByIdResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        PutApiPromptsByIdResponse200,
        PutApiPromptsByIdResponse400,
        PutApiPromptsByIdResponse401,
        PutApiPromptsByIdResponse404,
        PutApiPromptsByIdResponse500,
    ]
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
    client: Union[AuthenticatedClient, Client],
    body: PutApiPromptsByIdBody,
) -> Response[
    Union[
        PutApiPromptsByIdResponse200,
        PutApiPromptsByIdResponse400,
        PutApiPromptsByIdResponse401,
        PutApiPromptsByIdResponse404,
        PutApiPromptsByIdResponse500,
    ]
]:
    """Update a prompt

    Args:
        id (str):
        body (PutApiPromptsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PutApiPromptsByIdResponse200, PutApiPromptsByIdResponse400, PutApiPromptsByIdResponse401, PutApiPromptsByIdResponse404, PutApiPromptsByIdResponse500]]
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
    body: PutApiPromptsByIdBody,
) -> Optional[
    Union[
        PutApiPromptsByIdResponse200,
        PutApiPromptsByIdResponse400,
        PutApiPromptsByIdResponse401,
        PutApiPromptsByIdResponse404,
        PutApiPromptsByIdResponse500,
    ]
]:
    """Update a prompt

    Args:
        id (str):
        body (PutApiPromptsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PutApiPromptsByIdResponse200, PutApiPromptsByIdResponse400, PutApiPromptsByIdResponse401, PutApiPromptsByIdResponse404, PutApiPromptsByIdResponse500]
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
    body: PutApiPromptsByIdBody,
) -> Response[
    Union[
        PutApiPromptsByIdResponse200,
        PutApiPromptsByIdResponse400,
        PutApiPromptsByIdResponse401,
        PutApiPromptsByIdResponse404,
        PutApiPromptsByIdResponse500,
    ]
]:
    """Update a prompt

    Args:
        id (str):
        body (PutApiPromptsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PutApiPromptsByIdResponse200, PutApiPromptsByIdResponse400, PutApiPromptsByIdResponse401, PutApiPromptsByIdResponse404, PutApiPromptsByIdResponse500]]
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
    body: PutApiPromptsByIdBody,
) -> Optional[
    Union[
        PutApiPromptsByIdResponse200,
        PutApiPromptsByIdResponse400,
        PutApiPromptsByIdResponse401,
        PutApiPromptsByIdResponse404,
        PutApiPromptsByIdResponse500,
    ]
]:
    """Update a prompt

    Args:
        id (str):
        body (PutApiPromptsByIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PutApiPromptsByIdResponse200, PutApiPromptsByIdResponse400, PutApiPromptsByIdResponse401, PutApiPromptsByIdResponse404, PutApiPromptsByIdResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
