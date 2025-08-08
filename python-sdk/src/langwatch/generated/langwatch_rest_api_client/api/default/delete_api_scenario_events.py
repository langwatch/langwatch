from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_scenario_events_response_200 import DeleteApiScenarioEventsResponse200
from ...models.delete_api_scenario_events_response_400 import DeleteApiScenarioEventsResponse400
from ...models.delete_api_scenario_events_response_401 import DeleteApiScenarioEventsResponse401
from ...models.delete_api_scenario_events_response_500 import DeleteApiScenarioEventsResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/scenario-events",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[
    Union[
        DeleteApiScenarioEventsResponse200,
        DeleteApiScenarioEventsResponse400,
        DeleteApiScenarioEventsResponse401,
        DeleteApiScenarioEventsResponse500,
    ]
]:
    if response.status_code == 200:
        response_200 = DeleteApiScenarioEventsResponse200.from_dict(response.json())

        return response_200
    if response.status_code == 400:
        response_400 = DeleteApiScenarioEventsResponse400.from_dict(response.json())

        return response_400
    if response.status_code == 401:
        response_401 = DeleteApiScenarioEventsResponse401.from_dict(response.json())

        return response_401
    if response.status_code == 500:
        response_500 = DeleteApiScenarioEventsResponse500.from_dict(response.json())

        return response_500
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[
    Union[
        DeleteApiScenarioEventsResponse200,
        DeleteApiScenarioEventsResponse400,
        DeleteApiScenarioEventsResponse401,
        DeleteApiScenarioEventsResponse500,
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
        DeleteApiScenarioEventsResponse200,
        DeleteApiScenarioEventsResponse400,
        DeleteApiScenarioEventsResponse401,
        DeleteApiScenarioEventsResponse500,
    ]
]:
    """Delete all events

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[DeleteApiScenarioEventsResponse200, DeleteApiScenarioEventsResponse400, DeleteApiScenarioEventsResponse401, DeleteApiScenarioEventsResponse500]]
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
        DeleteApiScenarioEventsResponse200,
        DeleteApiScenarioEventsResponse400,
        DeleteApiScenarioEventsResponse401,
        DeleteApiScenarioEventsResponse500,
    ]
]:
    """Delete all events

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[DeleteApiScenarioEventsResponse200, DeleteApiScenarioEventsResponse400, DeleteApiScenarioEventsResponse401, DeleteApiScenarioEventsResponse500]
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
) -> Response[
    Union[
        DeleteApiScenarioEventsResponse200,
        DeleteApiScenarioEventsResponse400,
        DeleteApiScenarioEventsResponse401,
        DeleteApiScenarioEventsResponse500,
    ]
]:
    """Delete all events

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[DeleteApiScenarioEventsResponse200, DeleteApiScenarioEventsResponse400, DeleteApiScenarioEventsResponse401, DeleteApiScenarioEventsResponse500]]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: Union[AuthenticatedClient, Client],
) -> Optional[
    Union[
        DeleteApiScenarioEventsResponse200,
        DeleteApiScenarioEventsResponse400,
        DeleteApiScenarioEventsResponse401,
        DeleteApiScenarioEventsResponse500,
    ]
]:
    """Delete all events

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[DeleteApiScenarioEventsResponse200, DeleteApiScenarioEventsResponse400, DeleteApiScenarioEventsResponse401, DeleteApiScenarioEventsResponse500]
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
