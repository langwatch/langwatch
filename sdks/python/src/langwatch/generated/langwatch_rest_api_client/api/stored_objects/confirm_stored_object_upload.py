from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.confirm_stored_object_upload_body import ConfirmStoredObjectUploadBody
from ...models.confirm_stored_object_upload_response_200 import ConfirmStoredObjectUploadResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    upload_token: str,
    *,
    body: ConfirmStoredObjectUploadBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/stored-objects/{upload_token}/confirmation".format(
            upload_token=quote(str(upload_token), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ConfirmStoredObjectUploadResponse200 | None:
    if response.status_code == 200:
        response_200 = ConfirmStoredObjectUploadResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ConfirmStoredObjectUploadResponse200]:
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
    upload_token: str,
    *,
    client: AuthenticatedClient,
    body: ConfirmStoredObjectUploadBody,
) -> Response[ConfirmStoredObjectUploadResponse200]:
    """Confirm a stored-object upload

    Args:
        upload_token (str):
        body (ConfirmStoredObjectUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ConfirmStoredObjectUploadResponse200]
    """

    kwargs = _get_kwargs(
        upload_token=upload_token,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    upload_token: str,
    *,
    client: AuthenticatedClient,
    body: ConfirmStoredObjectUploadBody,
) -> ConfirmStoredObjectUploadResponse200 | None:
    """Confirm a stored-object upload

    Args:
        upload_token (str):
        body (ConfirmStoredObjectUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ConfirmStoredObjectUploadResponse200
    """

    return sync_detailed(
        upload_token=upload_token,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    upload_token: str,
    *,
    client: AuthenticatedClient,
    body: ConfirmStoredObjectUploadBody,
) -> Response[ConfirmStoredObjectUploadResponse200]:
    """Confirm a stored-object upload

    Args:
        upload_token (str):
        body (ConfirmStoredObjectUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ConfirmStoredObjectUploadResponse200]
    """

    kwargs = _get_kwargs(
        upload_token=upload_token,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    upload_token: str,
    *,
    client: AuthenticatedClient,
    body: ConfirmStoredObjectUploadBody,
) -> ConfirmStoredObjectUploadResponse200 | None:
    """Confirm a stored-object upload

    Args:
        upload_token (str):
        body (ConfirmStoredObjectUploadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ConfirmStoredObjectUploadResponse200
    """

    return (
        await asyncio_detailed(
            upload_token=upload_token,
            client=client,
            body=body,
        )
    ).parsed
