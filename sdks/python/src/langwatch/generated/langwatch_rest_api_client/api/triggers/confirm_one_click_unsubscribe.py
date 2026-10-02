from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.confirm_one_click_unsubscribe_response_200 import ConfirmOneClickUnsubscribeResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    token: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["token"] = token

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/unsubscribe",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ConfirmOneClickUnsubscribeResponse200 | None:
    if response.status_code == 200:
        response_200 = ConfirmOneClickUnsubscribeResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 429:
        response_429 = cast(Any, None)
        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ConfirmOneClickUnsubscribeResponse200]:
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
    token: str | Unset = UNSET,
) -> Response[Any | ConfirmOneClickUnsubscribeResponse200]:
    """RFC 8058 one-click unsubscribe

     Stop the automation named by the signed token in `token` from mailing this recipient.

    Args:
        token (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ConfirmOneClickUnsubscribeResponse200]
    """

    kwargs = _get_kwargs(
        token=token,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    token: str | Unset = UNSET,
) -> Any | ConfirmOneClickUnsubscribeResponse200 | None:
    """RFC 8058 one-click unsubscribe

     Stop the automation named by the signed token in `token` from mailing this recipient.

    Args:
        token (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ConfirmOneClickUnsubscribeResponse200
    """

    return sync_detailed(
        client=client,
        token=token,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    token: str | Unset = UNSET,
) -> Response[Any | ConfirmOneClickUnsubscribeResponse200]:
    """RFC 8058 one-click unsubscribe

     Stop the automation named by the signed token in `token` from mailing this recipient.

    Args:
        token (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ConfirmOneClickUnsubscribeResponse200]
    """

    kwargs = _get_kwargs(
        token=token,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    token: str | Unset = UNSET,
) -> Any | ConfirmOneClickUnsubscribeResponse200 | None:
    """RFC 8058 one-click unsubscribe

     Stop the automation named by the signed token in `token` from mailing this recipient.

    Args:
        token (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ConfirmOneClickUnsubscribeResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            token=token,
        )
    ).parsed
