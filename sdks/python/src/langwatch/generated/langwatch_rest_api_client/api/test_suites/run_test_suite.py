from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.run_test_suite_body import RunTestSuiteBody
from ...models.run_test_suite_response_200 import RunTestSuiteResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: RunTestSuiteBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/test-suites/{id}/run".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> RunTestSuiteResponse200 | None:
    if response.status_code == 200:
        response_200 = RunTestSuiteResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[RunTestSuiteResponse200]:
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
    body: RunTestSuiteBody,
) -> Response[RunTestSuiteResponse200]:
    """Run every scenario filed in the test suite against the targets sent with the request. The run is
    filed under a run plan named after the suite and its targets unless a name is sent. A request that
    names no target answers 422 suite_targets_required.

    Args:
        id (str):
        body (RunTestSuiteBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RunTestSuiteResponse200]
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
    body: RunTestSuiteBody,
) -> RunTestSuiteResponse200 | None:
    """Run every scenario filed in the test suite against the targets sent with the request. The run is
    filed under a run plan named after the suite and its targets unless a name is sent. A request that
    names no target answers 422 suite_targets_required.

    Args:
        id (str):
        body (RunTestSuiteBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RunTestSuiteResponse200
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
    body: RunTestSuiteBody,
) -> Response[RunTestSuiteResponse200]:
    """Run every scenario filed in the test suite against the targets sent with the request. The run is
    filed under a run plan named after the suite and its targets unless a name is sent. A request that
    names no target answers 422 suite_targets_required.

    Args:
        id (str):
        body (RunTestSuiteBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[RunTestSuiteResponse200]
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
    body: RunTestSuiteBody,
) -> RunTestSuiteResponse200 | None:
    """Run every scenario filed in the test suite against the targets sent with the request. The run is
    filed under a run plan named after the suite and its targets unless a name is sent. A request that
    names no target answers 422 suite_targets_required.

    Args:
        id (str):
        body (RunTestSuiteBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        RunTestSuiteResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
