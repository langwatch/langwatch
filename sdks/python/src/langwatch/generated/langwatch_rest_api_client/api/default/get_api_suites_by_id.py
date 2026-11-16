from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_suites_by_id_response_200 import GetApiSuitesByIdResponse200
from ...models.get_api_suites_by_id_response_404 import GetApiSuitesByIdResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/suites/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404 | None:
    if response.status_code == 200:
        response_200 = GetApiSuitesByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetApiSuitesByIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404]:
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
) -> Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404]:
    """Get a suite (run plan) by its ID. Deprecated: use /api/v1/run-plans and /api/v1/test-suites.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
) -> GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404 | None:
    """Get a suite (run plan) by its ID. Deprecated: use /api/v1/run-plans and /api/v1/test-suites.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404]:
    """Get a suite (run plan) by its ID. Deprecated: use /api/v1/run-plans and /api/v1/test-suites.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404 | None:
    """Get a suite (run plan) by its ID. Deprecated: use /api/v1/run-plans and /api/v1/test-suites.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSuitesByIdResponse200 | GetApiSuitesByIdResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
