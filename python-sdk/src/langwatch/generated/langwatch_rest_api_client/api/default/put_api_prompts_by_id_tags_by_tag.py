from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_prompts_by_id_tags_by_tag_body import PutApiPromptsByIdTagsByTagBody
from ...models.put_api_prompts_by_id_tags_by_tag_response_200 import PutApiPromptsByIdTagsByTagResponse200
from ...models.put_api_prompts_by_id_tags_by_tag_response_400 import PutApiPromptsByIdTagsByTagResponse400
from ...models.put_api_prompts_by_id_tags_by_tag_response_401 import PutApiPromptsByIdTagsByTagResponse401
from ...models.put_api_prompts_by_id_tags_by_tag_response_404 import PutApiPromptsByIdTagsByTagResponse404
from ...models.put_api_prompts_by_id_tags_by_tag_response_422 import PutApiPromptsByIdTagsByTagResponse422
from ...models.put_api_prompts_by_id_tags_by_tag_response_500 import PutApiPromptsByIdTagsByTagResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    tag: str,
    *,
    body: PutApiPromptsByIdTagsByTagBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/prompts/{id}/tags/{tag}".format(
            id=quote(str(id), safe=""),
            tag=quote(str(tag), safe=""),
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
    PutApiPromptsByIdTagsByTagResponse200
    | PutApiPromptsByIdTagsByTagResponse400
    | PutApiPromptsByIdTagsByTagResponse401
    | PutApiPromptsByIdTagsByTagResponse404
    | PutApiPromptsByIdTagsByTagResponse422
    | PutApiPromptsByIdTagsByTagResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiPromptsByIdTagsByTagResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiPromptsByIdTagsByTagResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiPromptsByIdTagsByTagResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PutApiPromptsByIdTagsByTagResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PutApiPromptsByIdTagsByTagResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiPromptsByIdTagsByTagResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiPromptsByIdTagsByTagResponse200
    | PutApiPromptsByIdTagsByTagResponse400
    | PutApiPromptsByIdTagsByTagResponse401
    | PutApiPromptsByIdTagsByTagResponse404
    | PutApiPromptsByIdTagsByTagResponse422
    | PutApiPromptsByIdTagsByTagResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    tag: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiPromptsByIdTagsByTagBody | Unset = UNSET,
) -> Response[
    PutApiPromptsByIdTagsByTagResponse200
    | PutApiPromptsByIdTagsByTagResponse400
    | PutApiPromptsByIdTagsByTagResponse401
    | PutApiPromptsByIdTagsByTagResponse404
    | PutApiPromptsByIdTagsByTagResponse422
    | PutApiPromptsByIdTagsByTagResponse500
]:
    r"""Assign a tag (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        tag (str):
        body (PutApiPromptsByIdTagsByTagBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiPromptsByIdTagsByTagResponse200 | PutApiPromptsByIdTagsByTagResponse400 | PutApiPromptsByIdTagsByTagResponse401 | PutApiPromptsByIdTagsByTagResponse404 | PutApiPromptsByIdTagsByTagResponse422 | PutApiPromptsByIdTagsByTagResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        tag=tag,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    tag: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiPromptsByIdTagsByTagBody | Unset = UNSET,
) -> (
    PutApiPromptsByIdTagsByTagResponse200
    | PutApiPromptsByIdTagsByTagResponse400
    | PutApiPromptsByIdTagsByTagResponse401
    | PutApiPromptsByIdTagsByTagResponse404
    | PutApiPromptsByIdTagsByTagResponse422
    | PutApiPromptsByIdTagsByTagResponse500
    | None
):
    r"""Assign a tag (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        tag (str):
        body (PutApiPromptsByIdTagsByTagBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiPromptsByIdTagsByTagResponse200 | PutApiPromptsByIdTagsByTagResponse400 | PutApiPromptsByIdTagsByTagResponse401 | PutApiPromptsByIdTagsByTagResponse404 | PutApiPromptsByIdTagsByTagResponse422 | PutApiPromptsByIdTagsByTagResponse500
    """

    return sync_detailed(
        id=id,
        tag=tag,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    tag: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiPromptsByIdTagsByTagBody | Unset = UNSET,
) -> Response[
    PutApiPromptsByIdTagsByTagResponse200
    | PutApiPromptsByIdTagsByTagResponse400
    | PutApiPromptsByIdTagsByTagResponse401
    | PutApiPromptsByIdTagsByTagResponse404
    | PutApiPromptsByIdTagsByTagResponse422
    | PutApiPromptsByIdTagsByTagResponse500
]:
    r"""Assign a tag (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        tag (str):
        body (PutApiPromptsByIdTagsByTagBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiPromptsByIdTagsByTagResponse200 | PutApiPromptsByIdTagsByTagResponse400 | PutApiPromptsByIdTagsByTagResponse401 | PutApiPromptsByIdTagsByTagResponse404 | PutApiPromptsByIdTagsByTagResponse422 | PutApiPromptsByIdTagsByTagResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        tag=tag,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    tag: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiPromptsByIdTagsByTagBody | Unset = UNSET,
) -> (
    PutApiPromptsByIdTagsByTagResponse200
    | PutApiPromptsByIdTagsByTagResponse400
    | PutApiPromptsByIdTagsByTagResponse401
    | PutApiPromptsByIdTagsByTagResponse404
    | PutApiPromptsByIdTagsByTagResponse422
    | PutApiPromptsByIdTagsByTagResponse500
    | None
):
    r"""Assign a tag (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        tag (str):
        body (PutApiPromptsByIdTagsByTagBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiPromptsByIdTagsByTagResponse200 | PutApiPromptsByIdTagsByTagResponse400 | PutApiPromptsByIdTagsByTagResponse401 | PutApiPromptsByIdTagsByTagResponse404 | PutApiPromptsByIdTagsByTagResponse422 | PutApiPromptsByIdTagsByTagResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            tag=tag,
            client=client,
            body=body,
        )
    ).parsed
