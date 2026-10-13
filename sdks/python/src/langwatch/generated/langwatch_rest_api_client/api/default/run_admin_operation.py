from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.run_admin_operation_body import RunAdminOperationBody
from ...models.run_admin_operation_response_200 import RunAdminOperationResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    resource: str,
    *,
    body: RunAdminOperationBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/admin/{resource}".format(
            resource=quote(str(resource), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> RunAdminOperationResponse200 | None:
    if response.status_code == 200:
        response_200 = RunAdminOperationResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[RunAdminOperationResponse200]:
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
    resource: str,
    *,
    client: AuthenticatedClient | Client,
    body: RunAdminOperationBody,
) -> Response[RunAdminOperationResponse200]:
    """
    Args:
        resource (str):
        body (RunAdminOperationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RunAdminOperationResponse200]
    """

    kwargs = _get_kwargs(
        resource=resource,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    resource: str,
    *,
    client: AuthenticatedClient | Client,
    body: RunAdminOperationBody,
) -> RunAdminOperationResponse200 | None:
    """
    Args:
        resource (str):
        body (RunAdminOperationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RunAdminOperationResponse200
    """

    return sync_detailed(
        resource=resource,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    resource: str,
    *,
    client: AuthenticatedClient | Client,
    body: RunAdminOperationBody,
) -> Response[RunAdminOperationResponse200]:
    """
    Args:
        resource (str):
        body (RunAdminOperationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RunAdminOperationResponse200]
    """

    kwargs = _get_kwargs(
        resource=resource,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    resource: str,
    *,
    client: AuthenticatedClient | Client,
    body: RunAdminOperationBody,
) -> RunAdminOperationResponse200 | None:
    """
    Args:
        resource (str):
        body (RunAdminOperationBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RunAdminOperationResponse200
    """

    return (
        await asyncio_detailed(
            resource=resource,
            client=client,
            body=body,
        )
    ).parsed
