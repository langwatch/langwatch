from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_triggers_by_id_body import PatchApiTriggersByIdBody
from ...models.patch_api_triggers_by_id_response_200 import PatchApiTriggersByIdResponse200
from ...models.patch_api_triggers_by_id_response_404 import PatchApiTriggersByIdResponse404
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    trigger_id: str,
    *,
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/triggers/{trigger_id}".format(
            trigger_id=quote(str(trigger_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404 | None:
    if response.status_code == 200:
        response_200 = PatchApiTriggersByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PatchApiTriggersByIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404]:
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
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404]:
    """Update an automation. Every field is optional and what is left out is left alone, except
    `actionParams`, which replaces the delivery configuration as a whole. The delivery channel cannot be
    changed.

    Args:
        trigger_id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404 | None:
    """Update an automation. Every field is optional and what is left out is left alone, except
    `actionParams`, which replaces the delivery configuration as a whole. The delivery channel cannot be
    changed.

    Args:
        trigger_id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404
    """

    return sync_detailed(
        trigger_id=trigger_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404]:
    """Update an automation. Every field is optional and what is left out is left alone, except
    `actionParams`, which replaces the delivery configuration as a whole. The delivery channel cannot be
    changed.

    Args:
        trigger_id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404]
    """

    kwargs = _get_kwargs(
        trigger_id=trigger_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    trigger_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiTriggersByIdBody | Unset = UNSET,
) -> PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404 | None:
    """Update an automation. Every field is optional and what is left out is left alone, except
    `actionParams`, which replaces the delivery configuration as a whole. The delivery channel cannot be
    changed.

    Args:
        trigger_id (str):
        body (PatchApiTriggersByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiTriggersByIdResponse200 | PatchApiTriggersByIdResponse404
    """

    return (
        await asyncio_detailed(
            trigger_id=trigger_id,
            client=client,
            body=body,
        )
    ).parsed
