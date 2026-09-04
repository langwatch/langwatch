from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_scenario_events_response_200_type_0 import DeleteApiScenarioEventsResponse200Type0
from ...models.delete_api_scenario_events_response_200_type_1 import DeleteApiScenarioEventsResponse200Type1
from ...models.delete_api_scenario_events_response_400 import DeleteApiScenarioEventsResponse400
from ...models.delete_api_scenario_events_response_401 import DeleteApiScenarioEventsResponse401
from ...models.delete_api_scenario_events_response_404 import DeleteApiScenarioEventsResponse404
from ...models.delete_api_scenario_events_response_422 import DeleteApiScenarioEventsResponse422
from ...models.delete_api_scenario_events_response_500 import DeleteApiScenarioEventsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    scenario_set_id: str | Unset = UNSET,
    scenario_run_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["scenarioSetId"] = scenario_set_id

    params["scenarioRunId"] = scenario_run_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/scenario-events",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteApiScenarioEventsResponse200Type0
    | DeleteApiScenarioEventsResponse200Type1
    | DeleteApiScenarioEventsResponse400
    | DeleteApiScenarioEventsResponse401
    | DeleteApiScenarioEventsResponse404
    | DeleteApiScenarioEventsResponse422
    | DeleteApiScenarioEventsResponse500
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> DeleteApiScenarioEventsResponse200Type0 | DeleteApiScenarioEventsResponse200Type1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = DeleteApiScenarioEventsResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = DeleteApiScenarioEventsResponse200Type1.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteApiScenarioEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiScenarioEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = DeleteApiScenarioEventsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = DeleteApiScenarioEventsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = DeleteApiScenarioEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteApiScenarioEventsResponse200Type0
    | DeleteApiScenarioEventsResponse200Type1
    | DeleteApiScenarioEventsResponse400
    | DeleteApiScenarioEventsResponse401
    | DeleteApiScenarioEventsResponse404
    | DeleteApiScenarioEventsResponse422
    | DeleteApiScenarioEventsResponse500
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
    *,
    client: AuthenticatedClient,
    scenario_set_id: str | Unset = UNSET,
    scenario_run_id: str | Unset = UNSET,
) -> Response[
    DeleteApiScenarioEventsResponse200Type0
    | DeleteApiScenarioEventsResponse200Type1
    | DeleteApiScenarioEventsResponse400
    | DeleteApiScenarioEventsResponse401
    | DeleteApiScenarioEventsResponse404
    | DeleteApiScenarioEventsResponse422
    | DeleteApiScenarioEventsResponse500
]:
    """Archive simulation runs. Pass exactly one of `scenarioSetId` (archives every run in the set;
    `scenarioSetId=default` targets the implicit default set) or `scenarioRunId` (archives that one
    run).

    Args:
        scenario_set_id (str | Unset):
        scenario_run_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiScenarioEventsResponse200Type0 | DeleteApiScenarioEventsResponse200Type1 | DeleteApiScenarioEventsResponse400 | DeleteApiScenarioEventsResponse401 | DeleteApiScenarioEventsResponse404 | DeleteApiScenarioEventsResponse422 | DeleteApiScenarioEventsResponse500]
    """

    kwargs = _get_kwargs(
        scenario_set_id=scenario_set_id,
        scenario_run_id=scenario_run_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    scenario_set_id: str | Unset = UNSET,
    scenario_run_id: str | Unset = UNSET,
) -> (
    DeleteApiScenarioEventsResponse200Type0
    | DeleteApiScenarioEventsResponse200Type1
    | DeleteApiScenarioEventsResponse400
    | DeleteApiScenarioEventsResponse401
    | DeleteApiScenarioEventsResponse404
    | DeleteApiScenarioEventsResponse422
    | DeleteApiScenarioEventsResponse500
    | None
):
    """Archive simulation runs. Pass exactly one of `scenarioSetId` (archives every run in the set;
    `scenarioSetId=default` targets the implicit default set) or `scenarioRunId` (archives that one
    run).

    Args:
        scenario_set_id (str | Unset):
        scenario_run_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiScenarioEventsResponse200Type0 | DeleteApiScenarioEventsResponse200Type1 | DeleteApiScenarioEventsResponse400 | DeleteApiScenarioEventsResponse401 | DeleteApiScenarioEventsResponse404 | DeleteApiScenarioEventsResponse422 | DeleteApiScenarioEventsResponse500
    """

    return sync_detailed(
        client=client,
        scenario_set_id=scenario_set_id,
        scenario_run_id=scenario_run_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    scenario_set_id: str | Unset = UNSET,
    scenario_run_id: str | Unset = UNSET,
) -> Response[
    DeleteApiScenarioEventsResponse200Type0
    | DeleteApiScenarioEventsResponse200Type1
    | DeleteApiScenarioEventsResponse400
    | DeleteApiScenarioEventsResponse401
    | DeleteApiScenarioEventsResponse404
    | DeleteApiScenarioEventsResponse422
    | DeleteApiScenarioEventsResponse500
]:
    """Archive simulation runs. Pass exactly one of `scenarioSetId` (archives every run in the set;
    `scenarioSetId=default` targets the implicit default set) or `scenarioRunId` (archives that one
    run).

    Args:
        scenario_set_id (str | Unset):
        scenario_run_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiScenarioEventsResponse200Type0 | DeleteApiScenarioEventsResponse200Type1 | DeleteApiScenarioEventsResponse400 | DeleteApiScenarioEventsResponse401 | DeleteApiScenarioEventsResponse404 | DeleteApiScenarioEventsResponse422 | DeleteApiScenarioEventsResponse500]
    """

    kwargs = _get_kwargs(
        scenario_set_id=scenario_set_id,
        scenario_run_id=scenario_run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    scenario_set_id: str | Unset = UNSET,
    scenario_run_id: str | Unset = UNSET,
) -> (
    DeleteApiScenarioEventsResponse200Type0
    | DeleteApiScenarioEventsResponse200Type1
    | DeleteApiScenarioEventsResponse400
    | DeleteApiScenarioEventsResponse401
    | DeleteApiScenarioEventsResponse404
    | DeleteApiScenarioEventsResponse422
    | DeleteApiScenarioEventsResponse500
    | None
):
    """Archive simulation runs. Pass exactly one of `scenarioSetId` (archives every run in the set;
    `scenarioSetId=default` targets the implicit default set) or `scenarioRunId` (archives that one
    run).

    Args:
        scenario_set_id (str | Unset):
        scenario_run_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiScenarioEventsResponse200Type0 | DeleteApiScenarioEventsResponse200Type1 | DeleteApiScenarioEventsResponse400 | DeleteApiScenarioEventsResponse401 | DeleteApiScenarioEventsResponse404 | DeleteApiScenarioEventsResponse422 | DeleteApiScenarioEventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            scenario_set_id=scenario_set_id,
            scenario_run_id=scenario_run_id,
        )
    ).parsed
