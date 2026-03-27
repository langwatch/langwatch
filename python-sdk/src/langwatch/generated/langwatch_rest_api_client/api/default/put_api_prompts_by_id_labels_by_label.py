from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_prompts_by_id_labels_by_label_body import PutApiPromptsByIdLabelsByLabelBody
from ...models.put_api_prompts_by_id_labels_by_label_response_200 import PutApiPromptsByIdLabelsByLabelResponse200
from ...models.put_api_prompts_by_id_labels_by_label_response_400 import PutApiPromptsByIdLabelsByLabelResponse400
from ...models.put_api_prompts_by_id_labels_by_label_response_401 import PutApiPromptsByIdLabelsByLabelResponse401
from ...models.put_api_prompts_by_id_labels_by_label_response_404 import PutApiPromptsByIdLabelsByLabelResponse404
from ...models.put_api_prompts_by_id_labels_by_label_response_422 import PutApiPromptsByIdLabelsByLabelResponse422
from ...models.put_api_prompts_by_id_labels_by_label_response_500 import PutApiPromptsByIdLabelsByLabelResponse500
from ...types import Response


def _get_kwargs(
    id: str,
    label: str,
    *,
    body: PutApiPromptsByIdLabelsByLabelBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": f"/api/prompts/{id}/labels/{label}",
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
        PutApiPromptsByIdLabelsByLabelResponse200,
        PutApiPromptsByIdLabelsByLabelResponse400,
        PutApiPromptsByIdLabelsByLabelResponse401,
        PutApiPromptsByIdLabelsByLabelResponse404,
        PutApiPromptsByIdLabelsByLabelResponse422,
        PutApiPromptsByIdLabelsByLabelResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = PutApiPromptsByIdLabelsByLabelResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = PutApiPromptsByIdLabelsByLabelResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = PutApiPromptsByIdLabelsByLabelResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 404:
        response_404 = PutApiPromptsByIdLabelsByLabelResponse404.from_dict(response.json())

        return response_404
    if response.status_code == 422:
        response_422 = PutApiPromptsByIdLabelsByLabelResponse422.from_dict(response.json())

        return response_422
    if response.status_code == 500:
        response_500 = PutApiPromptsByIdLabelsByLabelResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        PutApiPromptsByIdLabelsByLabelResponse200,
        PutApiPromptsByIdLabelsByLabelResponse400,
        PutApiPromptsByIdLabelsByLabelResponse401,
        PutApiPromptsByIdLabelsByLabelResponse404,
        PutApiPromptsByIdLabelsByLabelResponse422,
        PutApiPromptsByIdLabelsByLabelResponse500,
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
    label: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PutApiPromptsByIdLabelsByLabelBody,
) -> Response[
    Union[
        PutApiPromptsByIdLabelsByLabelResponse200,
        PutApiPromptsByIdLabelsByLabelResponse400,
        PutApiPromptsByIdLabelsByLabelResponse401,
        PutApiPromptsByIdLabelsByLabelResponse404,
        PutApiPromptsByIdLabelsByLabelResponse422,
        PutApiPromptsByIdLabelsByLabelResponse500,
    ]
]:
    r"""Assign a label (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        label (str):
        body (PutApiPromptsByIdLabelsByLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PutApiPromptsByIdLabelsByLabelResponse200, PutApiPromptsByIdLabelsByLabelResponse400, PutApiPromptsByIdLabelsByLabelResponse401, PutApiPromptsByIdLabelsByLabelResponse404, PutApiPromptsByIdLabelsByLabelResponse422, PutApiPromptsByIdLabelsByLabelResponse500]]
    """

    kwargs = _get_kwargs(
        id=id,
        label=label,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    label: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PutApiPromptsByIdLabelsByLabelBody,
) -> Optional[
    Union[
        PutApiPromptsByIdLabelsByLabelResponse200,
        PutApiPromptsByIdLabelsByLabelResponse400,
        PutApiPromptsByIdLabelsByLabelResponse401,
        PutApiPromptsByIdLabelsByLabelResponse404,
        PutApiPromptsByIdLabelsByLabelResponse422,
        PutApiPromptsByIdLabelsByLabelResponse500,
    ]
]:
    r"""Assign a label (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        label (str):
        body (PutApiPromptsByIdLabelsByLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PutApiPromptsByIdLabelsByLabelResponse200, PutApiPromptsByIdLabelsByLabelResponse400, PutApiPromptsByIdLabelsByLabelResponse401, PutApiPromptsByIdLabelsByLabelResponse404, PutApiPromptsByIdLabelsByLabelResponse422, PutApiPromptsByIdLabelsByLabelResponse500]
    """

    return sync_detailed(
        id=id,
        label=label,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    label: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PutApiPromptsByIdLabelsByLabelBody,
) -> Response[
    Union[
        PutApiPromptsByIdLabelsByLabelResponse200,
        PutApiPromptsByIdLabelsByLabelResponse400,
        PutApiPromptsByIdLabelsByLabelResponse401,
        PutApiPromptsByIdLabelsByLabelResponse404,
        PutApiPromptsByIdLabelsByLabelResponse422,
        PutApiPromptsByIdLabelsByLabelResponse500,
    ]
]:
    r"""Assign a label (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        label (str):
        body (PutApiPromptsByIdLabelsByLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[PutApiPromptsByIdLabelsByLabelResponse200, PutApiPromptsByIdLabelsByLabelResponse400, PutApiPromptsByIdLabelsByLabelResponse401, PutApiPromptsByIdLabelsByLabelResponse404, PutApiPromptsByIdLabelsByLabelResponse422, PutApiPromptsByIdLabelsByLabelResponse500]]
    """

    kwargs = _get_kwargs(
        id=id,
        label=label,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    label: str,
    *,
    client: Union[AuthenticatedClient, Client],
    body: PutApiPromptsByIdLabelsByLabelBody,
) -> Optional[
    Union[
        PutApiPromptsByIdLabelsByLabelResponse200,
        PutApiPromptsByIdLabelsByLabelResponse400,
        PutApiPromptsByIdLabelsByLabelResponse401,
        PutApiPromptsByIdLabelsByLabelResponse404,
        PutApiPromptsByIdLabelsByLabelResponse422,
        PutApiPromptsByIdLabelsByLabelResponse500,
    ]
]:
    r"""Assign a label (e.g. \"production\", \"staging\") to a specific prompt version

    Args:
        id (str):
        label (str):
        body (PutApiPromptsByIdLabelsByLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[PutApiPromptsByIdLabelsByLabelResponse200, PutApiPromptsByIdLabelsByLabelResponse400, PutApiPromptsByIdLabelsByLabelResponse401, PutApiPromptsByIdLabelsByLabelResponse404, PutApiPromptsByIdLabelsByLabelResponse422, PutApiPromptsByIdLabelsByLabelResponse500]
    """

    return (
        await asyncio_detailed(
            id=id,
            label=label,
            client=client,
            body=body,
        )
    ).parsed
