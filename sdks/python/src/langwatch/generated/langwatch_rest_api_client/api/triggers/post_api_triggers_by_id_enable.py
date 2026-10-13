from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_triggers_by_id_enable_response_200 import PostApiTriggersByIdEnableResponse200
from ...models.post_api_triggers_by_id_enable_response_404 import PostApiTriggersByIdEnableResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    trigger_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/triggers/{trigger_id}/enable".format(
            trigger_id=quote(str(trigger_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404 | None:
    if response.status_code == 200:
        response_200 = PostApiTriggersByIdEnableResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PostApiTriggersByIdEnableResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404]:
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
    trigger_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404]:
    """Resume a paused automation. A report goes back on its schedule; the pause record is cleared.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
) -> PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404 | None:
    """Resume a paused automation. A report goes back on its schedule; the pause record is cleared.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404
    """

    return sync_detailed(
        trigger_id=trigger_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404]:
    """Resume a paused automation. A report goes back on its schedule; the pause record is cleared.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
) -> PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404 | None:
    """Resume a paused automation. A report goes back on its schedule; the pause record is cleared.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse404
    """

    return (
        await asyncio_detailed(
            trigger_id=trigger_id,
            client=client,
        )
    ).parsed
