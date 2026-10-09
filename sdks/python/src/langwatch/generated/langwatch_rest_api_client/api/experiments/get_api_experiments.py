from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_response_200 import GetApiExperimentsResponse200
from ...models.get_api_experiments_response_400 import GetApiExperimentsResponse400
from ...models.get_api_experiments_response_401 import GetApiExperimentsResponse401
from ...models.get_api_experiments_response_422 import GetApiExperimentsResponse422
from ...models.get_api_experiments_response_500 import GetApiExperimentsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["page"] = page

    params["pageSize"] = page_size

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/experiments",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiExperimentsResponse200
    | GetApiExperimentsResponse400
    | GetApiExperimentsResponse401
    | GetApiExperimentsResponse422
    | GetApiExperimentsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiExperimentsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiExperimentsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiExperimentsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = GetApiExperimentsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiExperimentsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiExperimentsResponse200
    | GetApiExperimentsResponse400
    | GetApiExperimentsResponse401
    | GetApiExperimentsResponse422
    | GetApiExperimentsResponse500
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
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> Response[
    GetApiExperimentsResponse200
    | GetApiExperimentsResponse400
    | GetApiExperimentsResponse401
    | GetApiExperimentsResponse422
    | GetApiExperimentsResponse500
]:
    """List experiments for the project

     List experiments for the project. Includes a runs count and last-run timestamp per experiment.

    Args:
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsResponse200 | GetApiExperimentsResponse400 | GetApiExperimentsResponse401 | GetApiExperimentsResponse422 | GetApiExperimentsResponse500]
    """

    kwargs = _get_kwargs(
        page=page,
        page_size=page_size,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> (
    GetApiExperimentsResponse200
    | GetApiExperimentsResponse400
    | GetApiExperimentsResponse401
    | GetApiExperimentsResponse422
    | GetApiExperimentsResponse500
    | None
):
    """List experiments for the project

     List experiments for the project. Includes a runs count and last-run timestamp per experiment.

    Args:
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsResponse200 | GetApiExperimentsResponse400 | GetApiExperimentsResponse401 | GetApiExperimentsResponse422 | GetApiExperimentsResponse500
    """

    return sync_detailed(
        client=client,
        page=page,
        page_size=page_size,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> Response[
    GetApiExperimentsResponse200
    | GetApiExperimentsResponse400
    | GetApiExperimentsResponse401
    | GetApiExperimentsResponse422
    | GetApiExperimentsResponse500
]:
    """List experiments for the project

     List experiments for the project. Includes a runs count and last-run timestamp per experiment.

    Args:
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsResponse200 | GetApiExperimentsResponse400 | GetApiExperimentsResponse401 | GetApiExperimentsResponse422 | GetApiExperimentsResponse500]
    """

    kwargs = _get_kwargs(
        page=page,
        page_size=page_size,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    page: int | Unset = 1,
    page_size: int | Unset = 50,
) -> (
    GetApiExperimentsResponse200
    | GetApiExperimentsResponse400
    | GetApiExperimentsResponse401
    | GetApiExperimentsResponse422
    | GetApiExperimentsResponse500
    | None
):
    """List experiments for the project

     List experiments for the project. Includes a runs count and last-run timestamp per experiment.

    Args:
        page (int | Unset):  Default: 1.
        page_size (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsResponse200 | GetApiExperimentsResponse400 | GetApiExperimentsResponse401 | GetApiExperimentsResponse422 | GetApiExperimentsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            page=page,
            page_size=page_size,
        )
    ).parsed
