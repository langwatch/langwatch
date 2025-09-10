from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_evaluations_response_200 import GetApiEvaluationsResponse200
from ...models.get_api_evaluations_response_400 import GetApiEvaluationsResponse400
from ...models.get_api_evaluations_response_401 import GetApiEvaluationsResponse401
from ...models.get_api_evaluations_response_500 import GetApiEvaluationsResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/evaluations",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        GetApiEvaluationsResponse200,
        GetApiEvaluationsResponse400,
        GetApiEvaluationsResponse401,
        GetApiEvaluationsResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = GetApiEvaluationsResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = GetApiEvaluationsResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = GetApiEvaluationsResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 500:
        response_500 = GetApiEvaluationsResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        GetApiEvaluationsResponse200,
        GetApiEvaluationsResponse400,
        GetApiEvaluationsResponse401,
        GetApiEvaluationsResponse500,
    ]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        GetApiEvaluationsResponse200,
        GetApiEvaluationsResponse400,
        GetApiEvaluationsResponse401,
        GetApiEvaluationsResponse500,
    ]
]:
    """Get all available evaluators

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiEvaluationsResponse200, GetApiEvaluationsResponse400, GetApiEvaluationsResponse401, GetApiEvaluationsResponse500]]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        GetApiEvaluationsResponse200,
        GetApiEvaluationsResponse400,
        GetApiEvaluationsResponse401,
        GetApiEvaluationsResponse500,
    ]
]:
    """Get all available evaluators

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiEvaluationsResponse200, GetApiEvaluationsResponse400, GetApiEvaluationsResponse401, GetApiEvaluationsResponse500]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        GetApiEvaluationsResponse200,
        GetApiEvaluationsResponse400,
        GetApiEvaluationsResponse401,
        GetApiEvaluationsResponse500,
    ]
]:
    """Get all available evaluators

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[GetApiEvaluationsResponse200, GetApiEvaluationsResponse400, GetApiEvaluationsResponse401, GetApiEvaluationsResponse500]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        GetApiEvaluationsResponse200,
        GetApiEvaluationsResponse400,
        GetApiEvaluationsResponse401,
        GetApiEvaluationsResponse500,
    ]
]:
    """Get all available evaluators

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[GetApiEvaluationsResponse200, GetApiEvaluationsResponse400, GetApiEvaluationsResponse401, GetApiEvaluationsResponse500]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
