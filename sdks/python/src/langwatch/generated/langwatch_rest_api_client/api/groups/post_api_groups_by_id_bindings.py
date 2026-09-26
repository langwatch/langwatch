from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_groups_by_id_bindings_body import PostApiGroupsByIdBindingsBody
from ...models.post_api_groups_by_id_bindings_response_201 import PostApiGroupsByIdBindingsResponse201
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PostApiGroupsByIdBindingsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/groups/{id}/bindings".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiGroupsByIdBindingsResponse201 | None:
    if response.status_code == 201:
        response_201 = PostApiGroupsByIdBindingsResponse201.from_dict(response.json())

        return response_201

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiGroupsByIdBindingsResponse201]:
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
    body: PostApiGroupsByIdBindingsBody,
) -> Response[PostApiGroupsByIdBindingsResponse201]:
    """Add a role binding to a group

    Args:
        id (str):
        body (PostApiGroupsByIdBindingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGroupsByIdBindingsResponse201]
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
    body: PostApiGroupsByIdBindingsBody,
) -> PostApiGroupsByIdBindingsResponse201 | None:
    """Add a role binding to a group

    Args:
        id (str):
        body (PostApiGroupsByIdBindingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGroupsByIdBindingsResponse201
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
    body: PostApiGroupsByIdBindingsBody,
) -> Response[PostApiGroupsByIdBindingsResponse201]:
    """Add a role binding to a group

    Args:
        id (str):
        body (PostApiGroupsByIdBindingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGroupsByIdBindingsResponse201]
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
    body: PostApiGroupsByIdBindingsBody,
) -> PostApiGroupsByIdBindingsResponse201 | None:
    """Add a role binding to a group

    Args:
        id (str):
        body (PostApiGroupsByIdBindingsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGroupsByIdBindingsResponse201
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
