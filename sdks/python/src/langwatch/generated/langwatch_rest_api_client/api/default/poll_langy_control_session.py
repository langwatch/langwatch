from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.poll_langy_control_session_response_200 import PollLangyControlSessionResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    in_flight: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["inFlight"] = in_flight

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/langy/control/connect/poll",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PollLangyControlSessionResponse200 | None:
    if response.status_code == 200:
        response_200 = PollLangyControlSessionResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PollLangyControlSessionResponse200]:
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
    in_flight: str | Unset = UNSET,
) -> Response[PollLangyControlSessionResponse200]:
    """The frames waiting for the folder, or 410 when the instance token is not known.

    Args:
        in_flight (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PollLangyControlSessionResponse200]
    """

    kwargs = _get_kwargs(
        in_flight=in_flight,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    in_flight: str | Unset = UNSET,
) -> PollLangyControlSessionResponse200 | None:
    """The frames waiting for the folder, or 410 when the instance token is not known.

    Args:
        in_flight (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PollLangyControlSessionResponse200
    """

    return sync_detailed(
        client=client,
        in_flight=in_flight,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    in_flight: str | Unset = UNSET,
) -> Response[PollLangyControlSessionResponse200]:
    """The frames waiting for the folder, or 410 when the instance token is not known.

    Args:
        in_flight (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PollLangyControlSessionResponse200]
    """

    kwargs = _get_kwargs(
        in_flight=in_flight,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    in_flight: str | Unset = UNSET,
) -> PollLangyControlSessionResponse200 | None:
    """The frames waiting for the folder, or 410 when the instance token is not known.

    Args:
        in_flight (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PollLangyControlSessionResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            in_flight=in_flight,
        )
    ).parsed
