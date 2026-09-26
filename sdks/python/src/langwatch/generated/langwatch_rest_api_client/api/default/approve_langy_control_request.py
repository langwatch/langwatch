from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.approve_langy_control_request_body import ApproveLangyControlRequestBody
from ...models.approve_langy_control_request_response_200 import ApproveLangyControlRequestResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: ApproveLangyControlRequestBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/langy/control/requests/{id}/approve".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApproveLangyControlRequestResponse200 | None:
    if response.status_code == 200:
        response_200 = ApproveLangyControlRequestResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApproveLangyControlRequestResponse200]:
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
    body: ApproveLangyControlRequestBody,
) -> Response[ApproveLangyControlRequestResponse200]:
    """Approve one request and share the current folder with the conversation that asked. Answers with a
    Langy session key scoped to that conversation, which is never shown again. A request is single use:
    a second approval is refused.

    Args:
        id (str):
        body (ApproveLangyControlRequestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApproveLangyControlRequestResponse200]
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
    body: ApproveLangyControlRequestBody,
) -> ApproveLangyControlRequestResponse200 | None:
    """Approve one request and share the current folder with the conversation that asked. Answers with a
    Langy session key scoped to that conversation, which is never shown again. A request is single use:
    a second approval is refused.

    Args:
        id (str):
        body (ApproveLangyControlRequestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApproveLangyControlRequestResponse200
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
    body: ApproveLangyControlRequestBody,
) -> Response[ApproveLangyControlRequestResponse200]:
    """Approve one request and share the current folder with the conversation that asked. Answers with a
    Langy session key scoped to that conversation, which is never shown again. A request is single use:
    a second approval is refused.

    Args:
        id (str):
        body (ApproveLangyControlRequestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApproveLangyControlRequestResponse200]
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
    body: ApproveLangyControlRequestBody,
) -> ApproveLangyControlRequestResponse200 | None:
    """Approve one request and share the current folder with the conversation that asked. Answers with a
    Langy session key scoped to that conversation, which is never shown again. A request is single use:
    a second approval is refused.

    Args:
        id (str):
        body (ApproveLangyControlRequestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApproveLangyControlRequestResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
