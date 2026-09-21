from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_model_defaults_by_id_response_400 import DeleteApiModelDefaultsByIdResponse400
from ...models.delete_api_model_defaults_by_id_response_401 import DeleteApiModelDefaultsByIdResponse401
from ...models.delete_api_model_defaults_by_id_response_422 import DeleteApiModelDefaultsByIdResponse422
from ...models.delete_api_model_defaults_by_id_response_500 import DeleteApiModelDefaultsByIdResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/model-defaults/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    Any
    | DeleteApiModelDefaultsByIdResponse400
    | DeleteApiModelDefaultsByIdResponse401
    | DeleteApiModelDefaultsByIdResponse422
    | DeleteApiModelDefaultsByIdResponse500
    | None
):
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = DeleteApiModelDefaultsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = DeleteApiModelDefaultsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = DeleteApiModelDefaultsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = DeleteApiModelDefaultsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any
    | DeleteApiModelDefaultsByIdResponse400
    | DeleteApiModelDefaultsByIdResponse401
    | DeleteApiModelDefaultsByIdResponse422
    | DeleteApiModelDefaultsByIdResponse500
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
) -> Response[
    Any
    | DeleteApiModelDefaultsByIdResponse400
    | DeleteApiModelDefaultsByIdResponse401
    | DeleteApiModelDefaultsByIdResponse422
    | DeleteApiModelDefaultsByIdResponse500
]:
    """Delete a default-model config. Scope attachments cascade.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DeleteApiModelDefaultsByIdResponse400 | DeleteApiModelDefaultsByIdResponse401 | DeleteApiModelDefaultsByIdResponse422 | DeleteApiModelDefaultsByIdResponse500]
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
) -> (
    Any
    | DeleteApiModelDefaultsByIdResponse400
    | DeleteApiModelDefaultsByIdResponse401
    | DeleteApiModelDefaultsByIdResponse422
    | DeleteApiModelDefaultsByIdResponse500
    | None
):
    """Delete a default-model config. Scope attachments cascade.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DeleteApiModelDefaultsByIdResponse400 | DeleteApiModelDefaultsByIdResponse401 | DeleteApiModelDefaultsByIdResponse422 | DeleteApiModelDefaultsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    Any
    | DeleteApiModelDefaultsByIdResponse400
    | DeleteApiModelDefaultsByIdResponse401
    | DeleteApiModelDefaultsByIdResponse422
    | DeleteApiModelDefaultsByIdResponse500
]:
    """Delete a default-model config. Scope attachments cascade.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | DeleteApiModelDefaultsByIdResponse400 | DeleteApiModelDefaultsByIdResponse401 | DeleteApiModelDefaultsByIdResponse422 | DeleteApiModelDefaultsByIdResponse500]
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
) -> (
    Any
    | DeleteApiModelDefaultsByIdResponse400
    | DeleteApiModelDefaultsByIdResponse401
    | DeleteApiModelDefaultsByIdResponse422
    | DeleteApiModelDefaultsByIdResponse500
    | None
):
    """Delete a default-model config. Scope attachments cascade.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | DeleteApiModelDefaultsByIdResponse400 | DeleteApiModelDefaultsByIdResponse401 | DeleteApiModelDefaultsByIdResponse422 | DeleteApiModelDefaultsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
