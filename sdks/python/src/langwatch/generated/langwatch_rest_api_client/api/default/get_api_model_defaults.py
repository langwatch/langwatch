from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_model_defaults_response_200 import GetApiModelDefaultsResponse200
from ...models.get_api_model_defaults_response_400 import GetApiModelDefaultsResponse400
from ...models.get_api_model_defaults_response_401 import GetApiModelDefaultsResponse401
from ...models.get_api_model_defaults_response_422 import GetApiModelDefaultsResponse422
from ...models.get_api_model_defaults_response_500 import GetApiModelDefaultsResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/model-defaults",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiModelDefaultsResponse200
    | GetApiModelDefaultsResponse400
    | GetApiModelDefaultsResponse401
    | GetApiModelDefaultsResponse422
    | GetApiModelDefaultsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiModelDefaultsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiModelDefaultsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiModelDefaultsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiModelDefaultsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiModelDefaultsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiModelDefaultsResponse200
    | GetApiModelDefaultsResponse400
    | GetApiModelDefaultsResponse401
    | GetApiModelDefaultsResponse422
    | GetApiModelDefaultsResponse500
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
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiModelDefaultsResponse200
    | GetApiModelDefaultsResponse400
    | GetApiModelDefaultsResponse401
    | GetApiModelDefaultsResponse422
    | GetApiModelDefaultsResponse500
]:
    """Snapshot of the default-model cascade for this project: effective resolution per role, plus the
    configs the caller can read.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiModelDefaultsResponse200 | GetApiModelDefaultsResponse400 | GetApiModelDefaultsResponse401 | GetApiModelDefaultsResponse422 | GetApiModelDefaultsResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiModelDefaultsResponse200
    | GetApiModelDefaultsResponse400
    | GetApiModelDefaultsResponse401
    | GetApiModelDefaultsResponse422
    | GetApiModelDefaultsResponse500
    | None
):
    """Snapshot of the default-model cascade for this project: effective resolution per role, plus the
    configs the caller can read.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiModelDefaultsResponse200 | GetApiModelDefaultsResponse400 | GetApiModelDefaultsResponse401 | GetApiModelDefaultsResponse422 | GetApiModelDefaultsResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    GetApiModelDefaultsResponse200
    | GetApiModelDefaultsResponse400
    | GetApiModelDefaultsResponse401
    | GetApiModelDefaultsResponse422
    | GetApiModelDefaultsResponse500
]:
    """Snapshot of the default-model cascade for this project: effective resolution per role, plus the
    configs the caller can read.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiModelDefaultsResponse200 | GetApiModelDefaultsResponse400 | GetApiModelDefaultsResponse401 | GetApiModelDefaultsResponse422 | GetApiModelDefaultsResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> (
    GetApiModelDefaultsResponse200
    | GetApiModelDefaultsResponse400
    | GetApiModelDefaultsResponse401
    | GetApiModelDefaultsResponse422
    | GetApiModelDefaultsResponse500
    | None
):
    """Snapshot of the default-model cascade for this project: effective resolution per role, plus the
    configs the caller can read.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiModelDefaultsResponse200 | GetApiModelDefaultsResponse400 | GetApiModelDefaultsResponse401 | GetApiModelDefaultsResponse422 | GetApiModelDefaultsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
