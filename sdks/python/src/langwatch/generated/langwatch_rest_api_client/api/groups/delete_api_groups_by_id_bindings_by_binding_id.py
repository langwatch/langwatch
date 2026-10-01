from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_api_groups_by_id_bindings_by_binding_id_response_200 import (
    DeleteApiGroupsByIdBindingsByBindingIdResponse200,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    binding_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/groups/{id}/bindings/{binding_id}".format(
            id=quote(str(id), safe=""),
            binding_id=quote(str(binding_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> DeleteApiGroupsByIdBindingsByBindingIdResponse200 | None:
    if response.status_code == 200:
        response_200 = DeleteApiGroupsByIdBindingsByBindingIdResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[DeleteApiGroupsByIdBindingsByBindingIdResponse200]:
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
    binding_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[DeleteApiGroupsByIdBindingsByBindingIdResponse200]:
    """Remove a role binding from a group

    Args:
        id (str):
        binding_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGroupsByIdBindingsByBindingIdResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        binding_id=binding_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    binding_id: str,
    *,
    client: AuthenticatedClient,
) -> DeleteApiGroupsByIdBindingsByBindingIdResponse200 | None:
    """Remove a role binding from a group

    Args:
        id (str):
        binding_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGroupsByIdBindingsByBindingIdResponse200
    """

    return sync_detailed(
        id=id,
        binding_id=binding_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    binding_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[DeleteApiGroupsByIdBindingsByBindingIdResponse200]:
    """Remove a role binding from a group

    Args:
        id (str):
        binding_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteApiGroupsByIdBindingsByBindingIdResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        binding_id=binding_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    binding_id: str,
    *,
    client: AuthenticatedClient,
) -> DeleteApiGroupsByIdBindingsByBindingIdResponse200 | None:
    """Remove a role binding from a group

    Args:
        id (str):
        binding_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteApiGroupsByIdBindingsByBindingIdResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            binding_id=binding_id,
            client=client,
        )
    ).parsed
