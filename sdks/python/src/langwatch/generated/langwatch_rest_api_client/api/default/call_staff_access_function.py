from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.call_staff_access_function_body import CallStaffAccessFunctionBody
from ...models.call_staff_access_function_response_200 import CallStaffAccessFunctionResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    function_name: str,
    *,
    body: CallStaffAccessFunctionBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/staff-access/functions/{function_name}".format(
            function_name=quote(str(function_name), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CallStaffAccessFunctionResponse200 | None:
    if response.status_code == 200:
        response_200 = CallStaffAccessFunctionResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CallStaffAccessFunctionResponse200]:
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
    function_name: str,
    *,
    client: AuthenticatedClient | Client,
    body: CallStaffAccessFunctionBody | Unset = UNSET,
) -> Response[CallStaffAccessFunctionResponse200]:
    """
    Args:
        function_name (str):
        body (CallStaffAccessFunctionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CallStaffAccessFunctionResponse200]
    """

    kwargs = _get_kwargs(
        function_name=function_name,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    function_name: str,
    *,
    client: AuthenticatedClient | Client,
    body: CallStaffAccessFunctionBody | Unset = UNSET,
) -> CallStaffAccessFunctionResponse200 | None:
    """
    Args:
        function_name (str):
        body (CallStaffAccessFunctionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CallStaffAccessFunctionResponse200
    """

    return sync_detailed(
        function_name=function_name,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    function_name: str,
    *,
    client: AuthenticatedClient | Client,
    body: CallStaffAccessFunctionBody | Unset = UNSET,
) -> Response[CallStaffAccessFunctionResponse200]:
    """
    Args:
        function_name (str):
        body (CallStaffAccessFunctionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CallStaffAccessFunctionResponse200]
    """

    kwargs = _get_kwargs(
        function_name=function_name,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    function_name: str,
    *,
    client: AuthenticatedClient | Client,
    body: CallStaffAccessFunctionBody | Unset = UNSET,
) -> CallStaffAccessFunctionResponse200 | None:
    """
    Args:
        function_name (str):
        body (CallStaffAccessFunctionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CallStaffAccessFunctionResponse200
    """

    return (
        await asyncio_detailed(
            function_name=function_name,
            client=client,
            body=body,
        )
    ).parsed
