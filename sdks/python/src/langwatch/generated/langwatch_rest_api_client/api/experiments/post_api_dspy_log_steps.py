from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dspy_log_steps_body_item import PostApiDspyLogStepsBodyItem
from ...models.post_api_dspy_log_steps_response_200 import PostApiDspyLogStepsResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: list[PostApiDspyLogStepsBodyItem],
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/dspy/log_steps",
    }

    _kwargs["json"] = []
    for body_item_data in body:
        body_item = body_item_data.to_dict()
        _kwargs["json"].append(body_item)

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | PostApiDspyLogStepsResponse200 | None:
    if response.status_code == 200:
        response_200 = PostApiDspyLogStepsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 403:
        response_403 = cast(Any, None)
        return response_403

    if response.status_code == 413:
        response_413 = cast(Any, None)
        return response_413

    if response.status_code == 422:
        response_422 = cast(Any, None)
        return response_422

    if response.status_code == 500:
        response_500 = cast(Any, None)
        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | PostApiDspyLogStepsResponse200]:
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
    client: AuthenticatedClient,
    body: list[PostApiDspyLogStepsBodyItem],
) -> Response[Any | PostApiDspyLogStepsResponse200]:
    """Report DSPy optimizer steps

     Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores
    show up in the app. Send the steps as an array; the optimizer typically posts each batch as it
    finishes. Bodies up to 20MB are accepted.

    Args:
        body (list[PostApiDspyLogStepsBodyItem]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiDspyLogStepsResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: list[PostApiDspyLogStepsBodyItem],
) -> Any | PostApiDspyLogStepsResponse200 | None:
    """Report DSPy optimizer steps

     Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores
    show up in the app. Send the steps as an array; the optimizer typically posts each batch as it
    finishes. Bodies up to 20MB are accepted.

    Args:
        body (list[PostApiDspyLogStepsBodyItem]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiDspyLogStepsResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: list[PostApiDspyLogStepsBodyItem],
) -> Response[Any | PostApiDspyLogStepsResponse200]:
    """Report DSPy optimizer steps

     Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores
    show up in the app. Send the steps as an array; the optimizer typically posts each batch as it
    finishes. Bodies up to 20MB are accepted.

    Args:
        body (list[PostApiDspyLogStepsBodyItem]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiDspyLogStepsResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: list[PostApiDspyLogStepsBodyItem],
) -> Any | PostApiDspyLogStepsResponse200 | None:
    """Report DSPy optimizer steps

     Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores
    show up in the app. Send the steps as an array; the optimizer typically posts each batch as it
    finishes. Bodies up to 20MB are accepted.

    Args:
        body (list[PostApiDspyLogStepsBodyItem]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiDspyLogStepsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
