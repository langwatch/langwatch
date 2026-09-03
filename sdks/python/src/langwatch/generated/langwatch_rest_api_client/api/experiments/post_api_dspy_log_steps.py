from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_dspy_log_steps_body_item import PostApiDspyLogStepsBodyItem
from ...models.post_api_dspy_log_steps_response_200 import PostApiDspyLogStepsResponse200
from ...models.post_api_dspy_log_steps_response_400 import PostApiDspyLogStepsResponse400
from ...models.post_api_dspy_log_steps_response_401 import PostApiDspyLogStepsResponse401
from ...models.post_api_dspy_log_steps_response_403 import PostApiDspyLogStepsResponse403
from ...models.post_api_dspy_log_steps_response_500 import PostApiDspyLogStepsResponse500
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: list[PostApiDspyLogStepsBodyItem],
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/dspy/log_steps",
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
) -> (
    PostApiDspyLogStepsResponse200
    | PostApiDspyLogStepsResponse400
    | PostApiDspyLogStepsResponse401
    | PostApiDspyLogStepsResponse403
    | PostApiDspyLogStepsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiDspyLogStepsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiDspyLogStepsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiDspyLogStepsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiDspyLogStepsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiDspyLogStepsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiDspyLogStepsResponse200
    | PostApiDspyLogStepsResponse400
    | PostApiDspyLogStepsResponse401
    | PostApiDspyLogStepsResponse403
    | PostApiDspyLogStepsResponse500
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
    *,
    client: AuthenticatedClient,
    body: list[PostApiDspyLogStepsBodyItem],
) -> Response[
    PostApiDspyLogStepsResponse200
    | PostApiDspyLogStepsResponse400
    | PostApiDspyLogStepsResponse401
    | PostApiDspyLogStepsResponse403
    | PostApiDspyLogStepsResponse500
]:
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
        Response[PostApiDspyLogStepsResponse200 | PostApiDspyLogStepsResponse400 | PostApiDspyLogStepsResponse401 | PostApiDspyLogStepsResponse403 | PostApiDspyLogStepsResponse500]
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
) -> (
    PostApiDspyLogStepsResponse200
    | PostApiDspyLogStepsResponse400
    | PostApiDspyLogStepsResponse401
    | PostApiDspyLogStepsResponse403
    | PostApiDspyLogStepsResponse500
    | None
):
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
        PostApiDspyLogStepsResponse200 | PostApiDspyLogStepsResponse400 | PostApiDspyLogStepsResponse401 | PostApiDspyLogStepsResponse403 | PostApiDspyLogStepsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: list[PostApiDspyLogStepsBodyItem],
) -> Response[
    PostApiDspyLogStepsResponse200
    | PostApiDspyLogStepsResponse400
    | PostApiDspyLogStepsResponse401
    | PostApiDspyLogStepsResponse403
    | PostApiDspyLogStepsResponse500
]:
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
        Response[PostApiDspyLogStepsResponse200 | PostApiDspyLogStepsResponse400 | PostApiDspyLogStepsResponse401 | PostApiDspyLogStepsResponse403 | PostApiDspyLogStepsResponse500]
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
) -> (
    PostApiDspyLogStepsResponse200
    | PostApiDspyLogStepsResponse400
    | PostApiDspyLogStepsResponse401
    | PostApiDspyLogStepsResponse403
    | PostApiDspyLogStepsResponse500
    | None
):
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
        PostApiDspyLogStepsResponse200 | PostApiDspyLogStepsResponse400 | PostApiDspyLogStepsResponse401 | PostApiDspyLogStepsResponse403 | PostApiDspyLogStepsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
