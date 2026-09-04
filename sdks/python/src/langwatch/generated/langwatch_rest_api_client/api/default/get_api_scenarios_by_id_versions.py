from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_scenarios_by_id_versions_response_200 import GetApiScenariosByIdVersionsResponse200
from ...models.get_api_scenarios_by_id_versions_response_400 import GetApiScenariosByIdVersionsResponse400
from ...models.get_api_scenarios_by_id_versions_response_401 import GetApiScenariosByIdVersionsResponse401
from ...models.get_api_scenarios_by_id_versions_response_404 import GetApiScenariosByIdVersionsResponse404
from ...models.get_api_scenarios_by_id_versions_response_422 import GetApiScenariosByIdVersionsResponse422
from ...models.get_api_scenarios_by_id_versions_response_500 import GetApiScenariosByIdVersionsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/scenarios/{id}/versions".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiScenariosByIdVersionsResponse200
    | GetApiScenariosByIdVersionsResponse400
    | GetApiScenariosByIdVersionsResponse401
    | GetApiScenariosByIdVersionsResponse404
    | GetApiScenariosByIdVersionsResponse422
    | GetApiScenariosByIdVersionsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiScenariosByIdVersionsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiScenariosByIdVersionsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiScenariosByIdVersionsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiScenariosByIdVersionsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiScenariosByIdVersionsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiScenariosByIdVersionsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiScenariosByIdVersionsResponse200
    | GetApiScenariosByIdVersionsResponse400
    | GetApiScenariosByIdVersionsResponse401
    | GetApiScenariosByIdVersionsResponse404
    | GetApiScenariosByIdVersionsResponse422
    | GetApiScenariosByIdVersionsResponse500
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
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> Response[
    GetApiScenariosByIdVersionsResponse200
    | GetApiScenariosByIdVersionsResponse400
    | GetApiScenariosByIdVersionsResponse401
    | GetApiScenariosByIdVersionsResponse404
    | GetApiScenariosByIdVersionsResponse422
    | GetApiScenariosByIdVersionsResponse500
]:
    """List the saved versions of a scenario, newest first. A scenario saved before versions were recorded
    closes its history with a synthesized Created entry.

    Args:
        id (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiScenariosByIdVersionsResponse200 | GetApiScenariosByIdVersionsResponse400 | GetApiScenariosByIdVersionsResponse401 | GetApiScenariosByIdVersionsResponse404 | GetApiScenariosByIdVersionsResponse422 | GetApiScenariosByIdVersionsResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> (
    GetApiScenariosByIdVersionsResponse200
    | GetApiScenariosByIdVersionsResponse400
    | GetApiScenariosByIdVersionsResponse401
    | GetApiScenariosByIdVersionsResponse404
    | GetApiScenariosByIdVersionsResponse422
    | GetApiScenariosByIdVersionsResponse500
    | None
):
    """List the saved versions of a scenario, newest first. A scenario saved before versions were recorded
    closes its history with a synthesized Created entry.

    Args:
        id (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiScenariosByIdVersionsResponse200 | GetApiScenariosByIdVersionsResponse400 | GetApiScenariosByIdVersionsResponse401 | GetApiScenariosByIdVersionsResponse404 | GetApiScenariosByIdVersionsResponse422 | GetApiScenariosByIdVersionsResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> Response[
    GetApiScenariosByIdVersionsResponse200
    | GetApiScenariosByIdVersionsResponse400
    | GetApiScenariosByIdVersionsResponse401
    | GetApiScenariosByIdVersionsResponse404
    | GetApiScenariosByIdVersionsResponse422
    | GetApiScenariosByIdVersionsResponse500
]:
    """List the saved versions of a scenario, newest first. A scenario saved before versions were recorded
    closes its history with a synthesized Created entry.

    Args:
        id (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiScenariosByIdVersionsResponse200 | GetApiScenariosByIdVersionsResponse400 | GetApiScenariosByIdVersionsResponse401 | GetApiScenariosByIdVersionsResponse404 | GetApiScenariosByIdVersionsResponse422 | GetApiScenariosByIdVersionsResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: int | Unset = UNSET,
) -> (
    GetApiScenariosByIdVersionsResponse200
    | GetApiScenariosByIdVersionsResponse400
    | GetApiScenariosByIdVersionsResponse401
    | GetApiScenariosByIdVersionsResponse404
    | GetApiScenariosByIdVersionsResponse422
    | GetApiScenariosByIdVersionsResponse500
    | None
):
    """List the saved versions of a scenario, newest first. A scenario saved before versions were recorded
    closes its history with a synthesized Created entry.

    Args:
        id (str):
        limit (int | Unset):
        cursor (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiScenariosByIdVersionsResponse200 | GetApiScenariosByIdVersionsResponse400 | GetApiScenariosByIdVersionsResponse401 | GetApiScenariosByIdVersionsResponse404 | GetApiScenariosByIdVersionsResponse422 | GetApiScenariosByIdVersionsResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
