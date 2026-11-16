from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.cancel_langy_control_request_response_200 import CancelLangyControlRequestResponse200
from ...models.cancel_langy_control_request_response_400 import CancelLangyControlRequestResponse400
from ...types import Response, safe_http_status


def _get_kwargs(
    request_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/langy/control/requests/{request_id}/cancel".format(
            request_id=quote(str(request_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400 | None:
    if response.status_code == 200:
        response_200 = CancelLangyControlRequestResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = CancelLangyControlRequestResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400]:
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
    request_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400]:
    """Refuse one request from the terminal. The card in the chat reads that sharing was cancelled, and
    Langy's next turn offers the choice again.

    Args:
        request_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400]
    """

    kwargs = _get_kwargs(
        request_id=request_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    request_id: str,
    *,
    client: AuthenticatedClient,
) -> CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400 | None:
    """Refuse one request from the terminal. The card in the chat reads that sharing was cancelled, and
    Langy's next turn offers the choice again.

    Args:
        request_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400
    """

    return sync_detailed(
        request_id=request_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    request_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400]:
    """Refuse one request from the terminal. The card in the chat reads that sharing was cancelled, and
    Langy's next turn offers the choice again.

    Args:
        request_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400]
    """

    kwargs = _get_kwargs(
        request_id=request_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    request_id: str,
    *,
    client: AuthenticatedClient,
) -> CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400 | None:
    """Refuse one request from the terminal. The card in the chat reads that sharing was cancelled, and
    Langy's next turn offers the choice again.

    Args:
        request_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CancelLangyControlRequestResponse200 | CancelLangyControlRequestResponse400
    """

    return (
        await asyncio_detailed(
            request_id=request_id,
            client=client,
        )
    ).parsed
