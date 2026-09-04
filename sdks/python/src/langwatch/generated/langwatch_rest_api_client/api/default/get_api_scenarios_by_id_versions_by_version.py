from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_scenarios_by_id_versions_by_version_response_200 import (
    GetApiScenariosByIdVersionsByVersionResponse200,
)
from ...models.get_api_scenarios_by_id_versions_by_version_response_400 import (
    GetApiScenariosByIdVersionsByVersionResponse400,
)
from ...models.get_api_scenarios_by_id_versions_by_version_response_401 import (
    GetApiScenariosByIdVersionsByVersionResponse401,
)
from ...models.get_api_scenarios_by_id_versions_by_version_response_404 import (
    GetApiScenariosByIdVersionsByVersionResponse404,
)
from ...models.get_api_scenarios_by_id_versions_by_version_response_422 import (
    GetApiScenariosByIdVersionsByVersionResponse422,
)
from ...models.get_api_scenarios_by_id_versions_by_version_response_500 import (
    GetApiScenariosByIdVersionsByVersionResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    version: int,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/scenarios/{id}/versions/{version}".format(
            id=quote(str(id), safe=""),
            version=quote(str(version), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiScenariosByIdVersionsByVersionResponse200
    | GetApiScenariosByIdVersionsByVersionResponse400
    | GetApiScenariosByIdVersionsByVersionResponse401
    | GetApiScenariosByIdVersionsByVersionResponse404
    | GetApiScenariosByIdVersionsByVersionResponse422
    | GetApiScenariosByIdVersionsByVersionResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiScenariosByIdVersionsByVersionResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiScenariosByIdVersionsByVersionResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiScenariosByIdVersionsByVersionResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiScenariosByIdVersionsByVersionResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = GetApiScenariosByIdVersionsByVersionResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiScenariosByIdVersionsByVersionResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiScenariosByIdVersionsByVersionResponse200
    | GetApiScenariosByIdVersionsByVersionResponse400
    | GetApiScenariosByIdVersionsByVersionResponse401
    | GetApiScenariosByIdVersionsByVersionResponse404
    | GetApiScenariosByIdVersionsByVersionResponse422
    | GetApiScenariosByIdVersionsByVersionResponse500
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
    version: int,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiScenariosByIdVersionsByVersionResponse200
    | GetApiScenariosByIdVersionsByVersionResponse400
    | GetApiScenariosByIdVersionsByVersionResponse401
    | GetApiScenariosByIdVersionsByVersionResponse404
    | GetApiScenariosByIdVersionsByVersionResponse422
    | GetApiScenariosByIdVersionsByVersionResponse500
]:
    """Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as
    that version saved them.

    Args:
        id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiScenariosByIdVersionsByVersionResponse200 | GetApiScenariosByIdVersionsByVersionResponse400 | GetApiScenariosByIdVersionsByVersionResponse401 | GetApiScenariosByIdVersionsByVersionResponse404 | GetApiScenariosByIdVersionsByVersionResponse422 | GetApiScenariosByIdVersionsByVersionResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        version=version,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiScenariosByIdVersionsByVersionResponse200
    | GetApiScenariosByIdVersionsByVersionResponse400
    | GetApiScenariosByIdVersionsByVersionResponse401
    | GetApiScenariosByIdVersionsByVersionResponse404
    | GetApiScenariosByIdVersionsByVersionResponse422
    | GetApiScenariosByIdVersionsByVersionResponse500
    | None
):
    """Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as
    that version saved them.

    Args:
        id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiScenariosByIdVersionsByVersionResponse200 | GetApiScenariosByIdVersionsByVersionResponse400 | GetApiScenariosByIdVersionsByVersionResponse401 | GetApiScenariosByIdVersionsByVersionResponse404 | GetApiScenariosByIdVersionsByVersionResponse422 | GetApiScenariosByIdVersionsByVersionResponse500
    """

    return sync_detailed(
        id=id,
        version=version,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiScenariosByIdVersionsByVersionResponse200
    | GetApiScenariosByIdVersionsByVersionResponse400
    | GetApiScenariosByIdVersionsByVersionResponse401
    | GetApiScenariosByIdVersionsByVersionResponse404
    | GetApiScenariosByIdVersionsByVersionResponse422
    | GetApiScenariosByIdVersionsByVersionResponse500
]:
    """Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as
    that version saved them.

    Args:
        id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiScenariosByIdVersionsByVersionResponse200 | GetApiScenariosByIdVersionsByVersionResponse400 | GetApiScenariosByIdVersionsByVersionResponse401 | GetApiScenariosByIdVersionsByVersionResponse404 | GetApiScenariosByIdVersionsByVersionResponse422 | GetApiScenariosByIdVersionsByVersionResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        version=version,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    version: int,
    *,
    client: AuthenticatedClient,
) -> (
    GetApiScenariosByIdVersionsByVersionResponse200
    | GetApiScenariosByIdVersionsByVersionResponse400
    | GetApiScenariosByIdVersionsByVersionResponse401
    | GetApiScenariosByIdVersionsByVersionResponse404
    | GetApiScenariosByIdVersionsByVersionResponse422
    | GetApiScenariosByIdVersionsByVersionResponse500
    | None
):
    """Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as
    that version saved them.

    Args:
        id (str):
        version (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiScenariosByIdVersionsByVersionResponse200 | GetApiScenariosByIdVersionsByVersionResponse400 | GetApiScenariosByIdVersionsByVersionResponse401 | GetApiScenariosByIdVersionsByVersionResponse404 | GetApiScenariosByIdVersionsByVersionResponse422 | GetApiScenariosByIdVersionsByVersionResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            version=version,
            client=client,
        )
    ).parsed
