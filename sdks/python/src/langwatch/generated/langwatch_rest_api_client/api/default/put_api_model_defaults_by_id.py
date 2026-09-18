from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_model_defaults_by_id_body import PutApiModelDefaultsByIdBody
from ...models.put_api_model_defaults_by_id_response_400 import PutApiModelDefaultsByIdResponse400
from ...models.put_api_model_defaults_by_id_response_401 import PutApiModelDefaultsByIdResponse401
from ...models.put_api_model_defaults_by_id_response_422 import PutApiModelDefaultsByIdResponse422
from ...models.put_api_model_defaults_by_id_response_500 import PutApiModelDefaultsByIdResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PutApiModelDefaultsByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/model-defaults/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    Any
    | PutApiModelDefaultsByIdResponse400
    | PutApiModelDefaultsByIdResponse401
    | PutApiModelDefaultsByIdResponse422
    | PutApiModelDefaultsByIdResponse500
    | None
):
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = PutApiModelDefaultsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiModelDefaultsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PutApiModelDefaultsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiModelDefaultsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any
    | PutApiModelDefaultsByIdResponse400
    | PutApiModelDefaultsByIdResponse401
    | PutApiModelDefaultsByIdResponse422
    | PutApiModelDefaultsByIdResponse500
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
    client: AuthenticatedClient | Client,
    body: PutApiModelDefaultsByIdBody | Unset = UNSET,
) -> Response[
    Any
    | PutApiModelDefaultsByIdResponse400
    | PutApiModelDefaultsByIdResponse401
    | PutApiModelDefaultsByIdResponse422
    | PutApiModelDefaultsByIdResponse500
]:
    """Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the
    config.

    Args:
        id (str):
        body (PutApiModelDefaultsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PutApiModelDefaultsByIdResponse400 | PutApiModelDefaultsByIdResponse401 | PutApiModelDefaultsByIdResponse422 | PutApiModelDefaultsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelDefaultsByIdBody | Unset = UNSET,
) -> (
    Any
    | PutApiModelDefaultsByIdResponse400
    | PutApiModelDefaultsByIdResponse401
    | PutApiModelDefaultsByIdResponse422
    | PutApiModelDefaultsByIdResponse500
    | None
):
    """Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the
    config.

    Args:
        id (str):
        body (PutApiModelDefaultsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PutApiModelDefaultsByIdResponse400 | PutApiModelDefaultsByIdResponse401 | PutApiModelDefaultsByIdResponse422 | PutApiModelDefaultsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelDefaultsByIdBody | Unset = UNSET,
) -> Response[
    Any
    | PutApiModelDefaultsByIdResponse400
    | PutApiModelDefaultsByIdResponse401
    | PutApiModelDefaultsByIdResponse422
    | PutApiModelDefaultsByIdResponse500
]:
    """Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the
    config.

    Args:
        id (str):
        body (PutApiModelDefaultsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PutApiModelDefaultsByIdResponse400 | PutApiModelDefaultsByIdResponse401 | PutApiModelDefaultsByIdResponse422 | PutApiModelDefaultsByIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PutApiModelDefaultsByIdBody | Unset = UNSET,
) -> (
    Any
    | PutApiModelDefaultsByIdResponse400
    | PutApiModelDefaultsByIdResponse401
    | PutApiModelDefaultsByIdResponse422
    | PutApiModelDefaultsByIdResponse500
    | None
):
    """Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the
    config.

    Args:
        id (str):
        body (PutApiModelDefaultsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PutApiModelDefaultsByIdResponse400 | PutApiModelDefaultsByIdResponse401 | PutApiModelDefaultsByIdResponse422 | PutApiModelDefaultsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
