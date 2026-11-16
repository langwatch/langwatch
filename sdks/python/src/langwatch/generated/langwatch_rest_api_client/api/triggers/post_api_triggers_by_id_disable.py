from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_triggers_by_id_disable_response_200 import PostApiTriggersByIdDisableResponse200
from ...models.post_api_triggers_by_id_disable_response_404 import PostApiTriggersByIdDisableResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    trigger_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/triggers/{trigger_id}/disable".format(
            trigger_id=quote(str(trigger_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404 | None:
    if response.status_code == 200:
        response_200 = PostApiTriggersByIdDisableResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PostApiTriggersByIdDisableResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404]:
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
) -> Response[PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404]:
    """Pause an automation. A report stops claiming its schedule.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404]
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
) -> PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404 | None:
    """Pause an automation. A report stops claiming its schedule.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404
    """

    return sync_detailed(
        trigger_id=trigger_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404]:
    """Pause an automation. A report stops claiming its schedule.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404]
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
) -> PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404 | None:
    """Pause an automation. A report stops claiming its schedule.

    Args:
        trigger_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersByIdDisableResponse200 | PostApiTriggersByIdDisableResponse404
    """

    return (
        await asyncio_detailed(
            trigger_id=trigger_id,
            client=client,
        )
    ).parsed
