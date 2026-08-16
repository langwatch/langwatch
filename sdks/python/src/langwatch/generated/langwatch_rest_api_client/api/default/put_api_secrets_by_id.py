from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_secrets_by_id_body import PutApiSecretsByIdBody
from ...models.put_api_secrets_by_id_response_200 import PutApiSecretsByIdResponse200
from ...models.put_api_secrets_by_id_response_400 import PutApiSecretsByIdResponse400
from ...models.put_api_secrets_by_id_response_401 import PutApiSecretsByIdResponse401
from ...models.put_api_secrets_by_id_response_404 import PutApiSecretsByIdResponse404
from ...models.put_api_secrets_by_id_response_422 import PutApiSecretsByIdResponse422
from ...models.put_api_secrets_by_id_response_500 import PutApiSecretsByIdResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PutApiSecretsByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/secrets/{id}".format(
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
    PutApiSecretsByIdResponse200
    | PutApiSecretsByIdResponse400
    | PutApiSecretsByIdResponse401
    | PutApiSecretsByIdResponse404
    | PutApiSecretsByIdResponse422
    | PutApiSecretsByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PutApiSecretsByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiSecretsByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiSecretsByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PutApiSecretsByIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PutApiSecretsByIdResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PutApiSecretsByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiSecretsByIdResponse200
    | PutApiSecretsByIdResponse400
    | PutApiSecretsByIdResponse401
    | PutApiSecretsByIdResponse404
    | PutApiSecretsByIdResponse422
    | PutApiSecretsByIdResponse500
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
    body: PutApiSecretsByIdBody | Unset = UNSET,
) -> Response[
    PutApiSecretsByIdResponse200
    | PutApiSecretsByIdResponse400
    | PutApiSecretsByIdResponse401
    | PutApiSecretsByIdResponse404
    | PutApiSecretsByIdResponse422
    | PutApiSecretsByIdResponse500
]:
    """Update a secret's value

    Args:
        id (str):
        body (PutApiSecretsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiSecretsByIdResponse200 | PutApiSecretsByIdResponse400 | PutApiSecretsByIdResponse401 | PutApiSecretsByIdResponse404 | PutApiSecretsByIdResponse422 | PutApiSecretsByIdResponse500]
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
    client: AuthenticatedClient,
    body: PutApiSecretsByIdBody | Unset = UNSET,
) -> (
    PutApiSecretsByIdResponse200
    | PutApiSecretsByIdResponse400
    | PutApiSecretsByIdResponse401
    | PutApiSecretsByIdResponse404
    | PutApiSecretsByIdResponse422
    | PutApiSecretsByIdResponse500
    | None
):
    """Update a secret's value

    Args:
        id (str):
        body (PutApiSecretsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiSecretsByIdResponse200 | PutApiSecretsByIdResponse400 | PutApiSecretsByIdResponse401 | PutApiSecretsByIdResponse404 | PutApiSecretsByIdResponse422 | PutApiSecretsByIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: PutApiSecretsByIdBody | Unset = UNSET,
) -> Response[
    PutApiSecretsByIdResponse200
    | PutApiSecretsByIdResponse400
    | PutApiSecretsByIdResponse401
    | PutApiSecretsByIdResponse404
    | PutApiSecretsByIdResponse422
    | PutApiSecretsByIdResponse500
]:
    """Update a secret's value

    Args:
        id (str):
        body (PutApiSecretsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiSecretsByIdResponse200 | PutApiSecretsByIdResponse400 | PutApiSecretsByIdResponse401 | PutApiSecretsByIdResponse404 | PutApiSecretsByIdResponse422 | PutApiSecretsByIdResponse500]
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
    client: AuthenticatedClient,
    body: PutApiSecretsByIdBody | Unset = UNSET,
) -> (
    PutApiSecretsByIdResponse200
    | PutApiSecretsByIdResponse400
    | PutApiSecretsByIdResponse401
    | PutApiSecretsByIdResponse404
    | PutApiSecretsByIdResponse422
    | PutApiSecretsByIdResponse500
    | None
):
    """Update a secret's value

    Args:
        id (str):
        body (PutApiSecretsByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiSecretsByIdResponse200 | PutApiSecretsByIdResponse400 | PutApiSecretsByIdResponse401 | PutApiSecretsByIdResponse404 | PutApiSecretsByIdResponse422 | PutApiSecretsByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
