from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_triggers_by_id_enable_response_200 import PostApiTriggersByIdEnableResponse200
from ...models.post_api_triggers_by_id_enable_response_400 import PostApiTriggersByIdEnableResponse400
from ...models.post_api_triggers_by_id_enable_response_401 import PostApiTriggersByIdEnableResponse401
from ...models.post_api_triggers_by_id_enable_response_404 import PostApiTriggersByIdEnableResponse404
from ...models.post_api_triggers_by_id_enable_response_422 import PostApiTriggersByIdEnableResponse422
from ...models.post_api_triggers_by_id_enable_response_500 import PostApiTriggersByIdEnableResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/triggers/{id}/enable".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiTriggersByIdEnableResponse200
    | PostApiTriggersByIdEnableResponse400
    | PostApiTriggersByIdEnableResponse401
    | PostApiTriggersByIdEnableResponse404
    | PostApiTriggersByIdEnableResponse422
    | PostApiTriggersByIdEnableResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiTriggersByIdEnableResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiTriggersByIdEnableResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiTriggersByIdEnableResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiTriggersByIdEnableResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = PostApiTriggersByIdEnableResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiTriggersByIdEnableResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiTriggersByIdEnableResponse200
    | PostApiTriggersByIdEnableResponse400
    | PostApiTriggersByIdEnableResponse401
    | PostApiTriggersByIdEnableResponse404
    | PostApiTriggersByIdEnableResponse422
    | PostApiTriggersByIdEnableResponse500
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
) -> Response[
    PostApiTriggersByIdEnableResponse200
    | PostApiTriggersByIdEnableResponse400
    | PostApiTriggersByIdEnableResponse401
    | PostApiTriggersByIdEnableResponse404
    | PostApiTriggersByIdEnableResponse422
    | PostApiTriggersByIdEnableResponse500
]:
    """Resume an automation. A report's schedule is put back on the calendar.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse400 | PostApiTriggersByIdEnableResponse401 | PostApiTriggersByIdEnableResponse404 | PostApiTriggersByIdEnableResponse422 | PostApiTriggersByIdEnableResponse500]
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
) -> (
    PostApiTriggersByIdEnableResponse200
    | PostApiTriggersByIdEnableResponse400
    | PostApiTriggersByIdEnableResponse401
    | PostApiTriggersByIdEnableResponse404
    | PostApiTriggersByIdEnableResponse422
    | PostApiTriggersByIdEnableResponse500
    | None
):
    """Resume an automation. A report's schedule is put back on the calendar.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse400 | PostApiTriggersByIdEnableResponse401 | PostApiTriggersByIdEnableResponse404 | PostApiTriggersByIdEnableResponse422 | PostApiTriggersByIdEnableResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiTriggersByIdEnableResponse200
    | PostApiTriggersByIdEnableResponse400
    | PostApiTriggersByIdEnableResponse401
    | PostApiTriggersByIdEnableResponse404
    | PostApiTriggersByIdEnableResponse422
    | PostApiTriggersByIdEnableResponse500
]:
    """Resume an automation. A report's schedule is put back on the calendar.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse400 | PostApiTriggersByIdEnableResponse401 | PostApiTriggersByIdEnableResponse404 | PostApiTriggersByIdEnableResponse422 | PostApiTriggersByIdEnableResponse500]
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
) -> (
    PostApiTriggersByIdEnableResponse200
    | PostApiTriggersByIdEnableResponse400
    | PostApiTriggersByIdEnableResponse401
    | PostApiTriggersByIdEnableResponse404
    | PostApiTriggersByIdEnableResponse422
    | PostApiTriggersByIdEnableResponse500
    | None
):
    """Resume an automation. A report's schedule is put back on the calendar.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiTriggersByIdEnableResponse200 | PostApiTriggersByIdEnableResponse400 | PostApiTriggersByIdEnableResponse401 | PostApiTriggersByIdEnableResponse404 | PostApiTriggersByIdEnableResponse422 | PostApiTriggersByIdEnableResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
