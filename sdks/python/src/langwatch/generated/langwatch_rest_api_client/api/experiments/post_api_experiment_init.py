from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_experiment_init_response_200 import PostApiExperimentInitResponse200
from ...models.post_api_experiment_init_response_400_type_0 import PostApiExperimentInitResponse400Type0
from ...models.post_api_experiment_init_response_400_type_1 import PostApiExperimentInitResponse400Type1
from ...models.post_api_experiment_init_response_401 import PostApiExperimentInitResponse401
from ...models.post_api_experiment_init_response_403 import PostApiExperimentInitResponse403
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: Any,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/experiment/init",
    }

    _kwargs["json"] = body

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiExperimentInitResponse200
    | PostApiExperimentInitResponse400Type0
    | PostApiExperimentInitResponse400Type1
    | PostApiExperimentInitResponse401
    | PostApiExperimentInitResponse403
    | None
):
    if response.status_code == 200:
        response_200 = PostApiExperimentInitResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:

        def _parse_response_400(
            data: object,
        ) -> PostApiExperimentInitResponse400Type0 | PostApiExperimentInitResponse400Type1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = PostApiExperimentInitResponse400Type0.from_dict(data)

                return response_400_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_400_type_1 = PostApiExperimentInitResponse400Type1.from_dict(data)

            return response_400_type_1

        response_400 = _parse_response_400(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiExperimentInitResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiExperimentInitResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiExperimentInitResponse200
    | PostApiExperimentInitResponse400Type0
    | PostApiExperimentInitResponse400Type1
    | PostApiExperimentInitResponse401
    | PostApiExperimentInitResponse403
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
    body: Any,
) -> Response[
    PostApiExperimentInitResponse200
    | PostApiExperimentInitResponse400Type0
    | PostApiExperimentInitResponse400Type1
    | PostApiExperimentInitResponse401
    | PostApiExperimentInitResponse403
]:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you.

    Args:
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiExperimentInitResponse200 | PostApiExperimentInitResponse400Type0 | PostApiExperimentInitResponse400Type1 | PostApiExperimentInitResponse401 | PostApiExperimentInitResponse403]
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
    body: Any,
) -> (
    PostApiExperimentInitResponse200
    | PostApiExperimentInitResponse400Type0
    | PostApiExperimentInitResponse400Type1
    | PostApiExperimentInitResponse401
    | PostApiExperimentInitResponse403
    | None
):
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you.

    Args:
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiExperimentInitResponse200 | PostApiExperimentInitResponse400Type0 | PostApiExperimentInitResponse400Type1 | PostApiExperimentInitResponse401 | PostApiExperimentInitResponse403
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: Any,
) -> Response[
    PostApiExperimentInitResponse200
    | PostApiExperimentInitResponse400Type0
    | PostApiExperimentInitResponse400Type1
    | PostApiExperimentInitResponse401
    | PostApiExperimentInitResponse403
]:
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you.

    Args:
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiExperimentInitResponse200 | PostApiExperimentInitResponse400Type0 | PostApiExperimentInitResponse400Type1 | PostApiExperimentInitResponse401 | PostApiExperimentInitResponse403]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: Any,
) -> (
    PostApiExperimentInitResponse200
    | PostApiExperimentInitResponse400Type0
    | PostApiExperimentInitResponse400Type1
    | PostApiExperimentInitResponse401
    | PostApiExperimentInitResponse403
    | None
):
    """Create an experiment

     Create an experiment, or return the existing one when the slug is already taken. This is the first
    call in an experiment run: take the slug back, report results against it, and every run under that
    slug groups together in the app. The SDKs call this endpoint for you.

    Args:
        body (Any):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiExperimentInitResponse200 | PostApiExperimentInitResponse400Type0 | PostApiExperimentInitResponse400Type1 | PostApiExperimentInitResponse401 | PostApiExperimentInitResponse403
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
