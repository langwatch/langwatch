from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_suites_kind import GetApiSuitesKind
from ...models.get_api_suites_response_200_item import GetApiSuitesResponse200Item
from ...models.get_api_suites_response_400 import GetApiSuitesResponse400
from ...models.get_api_suites_response_401 import GetApiSuitesResponse401
from ...models.get_api_suites_response_422 import GetApiSuitesResponse422
from ...models.get_api_suites_response_500 import GetApiSuitesResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    kind: GetApiSuitesKind | Unset = GetApiSuitesKind.CUSTOM,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_kind: str | Unset = UNSET
    if not isinstance(kind, Unset):
        json_kind = kind.value

    params["kind"] = json_kind

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/suites",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiSuitesResponse400
    | GetApiSuitesResponse401
    | GetApiSuitesResponse422
    | GetApiSuitesResponse500
    | list[GetApiSuitesResponse200Item]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GetApiSuitesResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = GetApiSuitesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiSuitesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiSuitesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiSuitesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiSuitesResponse400
    | GetApiSuitesResponse401
    | GetApiSuitesResponse422
    | GetApiSuitesResponse500
    | list[GetApiSuitesResponse200Item]
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
    kind: GetApiSuitesKind | Unset = GetApiSuitesKind.CUSTOM,
) -> Response[
    GetApiSuitesResponse400
    | GetApiSuitesResponse401
    | GetApiSuitesResponse422
    | GetApiSuitesResponse500
    | list[GetApiSuitesResponse200Item]
]:
    """Deprecated: use /api/v1/run-plans and /api/v1/test-suites. List all non-archived suites for the
    project. By default only custom run plans are returned; pass kind=folder for test suite folders.

    Args:
        kind (GetApiSuitesKind | Unset):  Default: GetApiSuitesKind.CUSTOM.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSuitesResponse400 | GetApiSuitesResponse401 | GetApiSuitesResponse422 | GetApiSuitesResponse500 | list[GetApiSuitesResponse200Item]]
    """

    kwargs = _get_kwargs(
        kind=kind,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    kind: GetApiSuitesKind | Unset = GetApiSuitesKind.CUSTOM,
) -> (
    GetApiSuitesResponse400
    | GetApiSuitesResponse401
    | GetApiSuitesResponse422
    | GetApiSuitesResponse500
    | list[GetApiSuitesResponse200Item]
    | None
):
    """Deprecated: use /api/v1/run-plans and /api/v1/test-suites. List all non-archived suites for the
    project. By default only custom run plans are returned; pass kind=folder for test suite folders.

    Args:
        kind (GetApiSuitesKind | Unset):  Default: GetApiSuitesKind.CUSTOM.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSuitesResponse400 | GetApiSuitesResponse401 | GetApiSuitesResponse422 | GetApiSuitesResponse500 | list[GetApiSuitesResponse200Item]
    """

    return sync_detailed(
        client=client,
        kind=kind,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    kind: GetApiSuitesKind | Unset = GetApiSuitesKind.CUSTOM,
) -> Response[
    GetApiSuitesResponse400
    | GetApiSuitesResponse401
    | GetApiSuitesResponse422
    | GetApiSuitesResponse500
    | list[GetApiSuitesResponse200Item]
]:
    """Deprecated: use /api/v1/run-plans and /api/v1/test-suites. List all non-archived suites for the
    project. By default only custom run plans are returned; pass kind=folder for test suite folders.

    Args:
        kind (GetApiSuitesKind | Unset):  Default: GetApiSuitesKind.CUSTOM.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiSuitesResponse400 | GetApiSuitesResponse401 | GetApiSuitesResponse422 | GetApiSuitesResponse500 | list[GetApiSuitesResponse200Item]]
    """

    kwargs = _get_kwargs(
        kind=kind,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    kind: GetApiSuitesKind | Unset = GetApiSuitesKind.CUSTOM,
) -> (
    GetApiSuitesResponse400
    | GetApiSuitesResponse401
    | GetApiSuitesResponse422
    | GetApiSuitesResponse500
    | list[GetApiSuitesResponse200Item]
    | None
):
    """Deprecated: use /api/v1/run-plans and /api/v1/test-suites. List all non-archived suites for the
    project. By default only custom run plans are returned; pass kind=folder for test suite folders.

    Args:
        kind (GetApiSuitesKind | Unset):  Default: GetApiSuitesKind.CUSTOM.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiSuitesResponse400 | GetApiSuitesResponse401 | GetApiSuitesResponse422 | GetApiSuitesResponse500 | list[GetApiSuitesResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
            kind=kind,
        )
    ).parsed
