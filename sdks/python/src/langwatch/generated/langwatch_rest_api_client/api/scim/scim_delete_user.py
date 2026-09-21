from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.scim_delete_user_response_401 import ScimDeleteUserResponse401
from ...models.scim_delete_user_response_403 import ScimDeleteUserResponse403
from ...models.scim_delete_user_response_404 import ScimDeleteUserResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/scim/v2/Users/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404 | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 401:
        response_401 = ScimDeleteUserResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ScimDeleteUserResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ScimDeleteUserResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404]:
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
) -> Response[Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404]:
    """Deprovision a user

     Removes the member from the organization, drops the role bindings they held there, and deactivates
    their account. The LangWatch user record itself is kept, so past traces, evaluations and audit
    entries stay attributable.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404]
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
) -> Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404 | None:
    """Deprovision a user

     Removes the member from the organization, drops the role bindings they held there, and deactivates
    their account. The LangWatch user record itself is kept, so past traces, evaluations and audit
    entries stay attributable.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404]:
    """Deprovision a user

     Removes the member from the organization, drops the role bindings they held there, and deactivates
    their account. The LangWatch user record itself is kept, so past traces, evaluations and audit
    entries stay attributable.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404]
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
) -> Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404 | None:
    """Deprovision a user

     Removes the member from the organization, drops the role bindings they held there, and deactivates
    their account. The LangWatch user record itself is kept, so past traces, evaluations and audit
    entries stay attributable.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ScimDeleteUserResponse401 | ScimDeleteUserResponse403 | ScimDeleteUserResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
