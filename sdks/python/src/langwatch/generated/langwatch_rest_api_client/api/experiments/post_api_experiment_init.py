from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_experiment_init_body import PostApiExperimentInitBody
from ...models.post_api_experiment_init_response_200 import PostApiExperimentInitResponse200
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiExperimentInitBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/experiment/init",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | PostApiExperimentInitResponse200 | None:
    if response.status_code == 200:
        response_200 = PostApiExperimentInitResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | PostApiExperimentInitResponse200]:
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
    body: PostApiExperimentInitBody,
) -> Response[Any | PostApiExperimentInitResponse200]:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you. The body carries
    `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what
    makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and
    `workflowId` ties it to an Optimization Studio workflow.

    Args:
        body (PostApiExperimentInitBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiExperimentInitResponse200]
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
    body: PostApiExperimentInitBody,
) -> Any | PostApiExperimentInitResponse200 | None:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you. The body carries
    `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what
    makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and
    `workflowId` ties it to an Optimization Studio workflow.

    Args:
        body (PostApiExperimentInitBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiExperimentInitResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiExperimentInitBody,
) -> Response[Any | PostApiExperimentInitResponse200]:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you. The body carries
    `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what
    makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and
    `workflowId` ties it to an Optimization Studio workflow.

    Args:
        body (PostApiExperimentInitBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | PostApiExperimentInitResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiExperimentInitBody,
) -> Any | PostApiExperimentInitResponse200 | None:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you. The body carries
    `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what
    makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and
    `workflowId` ties it to an Optimization Studio workflow.

    Args:
        body (PostApiExperimentInitBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | PostApiExperimentInitResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
