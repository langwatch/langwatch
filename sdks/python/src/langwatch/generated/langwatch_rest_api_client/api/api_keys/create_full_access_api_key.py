from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_full_access_api_key_body import CreateFullAccessApiKeyBody
from ...models.create_full_access_api_key_response_201 import CreateFullAccessApiKeyResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: CreateFullAccessApiKeyBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/api-keys/full-access",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | CreateFullAccessApiKeyResponse201 | None:
    if response.status_code == 201:
        response_201 = CreateFullAccessApiKeyResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 422:
        response_422 = cast(Any, None)
        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | CreateFullAccessApiKeyResponse201]:
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
    body: CreateFullAccessApiKeyBody,
) -> Response[Any | CreateFullAccessApiKeyResponse201]:
    r"""Create a full-access API key

     Mint the caller's own API key for the project their sign-in session is bound to, as `langwatch login
    --project` does: it can do everything the caller can do in that project (prompts, datasets,
    evaluations, simulations, traces). Only one shape is accepted: keyType \"personal\", owned by the
    caller, one ADMIN binding to that project and permissionMode \"all\". Name it after the machine;
    omit expiresAt for a key that never expires. Requires a person's project session holding
    project:manage; an API key cannot mint one.

    Args:
        body (CreateFullAccessApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateFullAccessApiKeyResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: CreateFullAccessApiKeyBody,
) -> Any | CreateFullAccessApiKeyResponse201 | None:
    r"""Create a full-access API key

     Mint the caller's own API key for the project their sign-in session is bound to, as `langwatch login
    --project` does: it can do everything the caller can do in that project (prompts, datasets,
    evaluations, simulations, traces). Only one shape is accepted: keyType \"personal\", owned by the
    caller, one ADMIN binding to that project and permissionMode \"all\". Name it after the machine;
    omit expiresAt for a key that never expires. Requires a person's project session holding
    project:manage; an API key cannot mint one.

    Args:
        body (CreateFullAccessApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateFullAccessApiKeyResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CreateFullAccessApiKeyBody,
) -> Response[Any | CreateFullAccessApiKeyResponse201]:
    r"""Create a full-access API key

     Mint the caller's own API key for the project their sign-in session is bound to, as `langwatch login
    --project` does: it can do everything the caller can do in that project (prompts, datasets,
    evaluations, simulations, traces). Only one shape is accepted: keyType \"personal\", owned by the
    caller, one ADMIN binding to that project and permissionMode \"all\". Name it after the machine;
    omit expiresAt for a key that never expires. Requires a person's project session holding
    project:manage; an API key cannot mint one.

    Args:
        body (CreateFullAccessApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateFullAccessApiKeyResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CreateFullAccessApiKeyBody,
) -> Any | CreateFullAccessApiKeyResponse201 | None:
    r"""Create a full-access API key

     Mint the caller's own API key for the project their sign-in session is bound to, as `langwatch login
    --project` does: it can do everything the caller can do in that project (prompts, datasets,
    evaluations, simulations, traces). Only one shape is accepted: keyType \"personal\", owned by the
    caller, one ADMIN binding to that project and permissionMode \"all\". Name it after the machine;
    omit expiresAt for a key that never expires. Requires a person's project session holding
    project:manage; an API key cannot mint one.

    Args:
        body (CreateFullAccessApiKeyBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateFullAccessApiKeyResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
