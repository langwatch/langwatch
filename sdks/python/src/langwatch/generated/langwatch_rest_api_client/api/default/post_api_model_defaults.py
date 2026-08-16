from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_model_defaults_body import PostApiModelDefaultsBody
from ...models.post_api_model_defaults_response_200 import PostApiModelDefaultsResponse200
from ...models.post_api_model_defaults_response_400 import PostApiModelDefaultsResponse400
from ...models.post_api_model_defaults_response_401 import PostApiModelDefaultsResponse401
from ...models.post_api_model_defaults_response_422 import PostApiModelDefaultsResponse422
from ...models.post_api_model_defaults_response_500 import PostApiModelDefaultsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    body: PostApiModelDefaultsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/model-defaults",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiModelDefaultsResponse200
    | PostApiModelDefaultsResponse400
    | PostApiModelDefaultsResponse401
    | PostApiModelDefaultsResponse422
    | PostApiModelDefaultsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiModelDefaultsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiModelDefaultsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiModelDefaultsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 422:
        response_422 = PostApiModelDefaultsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiModelDefaultsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiModelDefaultsResponse200
    | PostApiModelDefaultsResponse400
    | PostApiModelDefaultsResponse401
    | PostApiModelDefaultsResponse422
    | PostApiModelDefaultsResponse500
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
    body: PostApiModelDefaultsBody | Unset = UNSET,
) -> Response[
    PostApiModelDefaultsResponse200
    | PostApiModelDefaultsResponse400
    | PostApiModelDefaultsResponse401
    | PostApiModelDefaultsResponse422
    | PostApiModelDefaultsResponse500
]:
    """Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST,
    LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.

    Args:
        body (PostApiModelDefaultsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiModelDefaultsResponse200 | PostApiModelDefaultsResponse400 | PostApiModelDefaultsResponse401 | PostApiModelDefaultsResponse422 | PostApiModelDefaultsResponse500]
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
    body: PostApiModelDefaultsBody | Unset = UNSET,
) -> (
    PostApiModelDefaultsResponse200
    | PostApiModelDefaultsResponse400
    | PostApiModelDefaultsResponse401
    | PostApiModelDefaultsResponse422
    | PostApiModelDefaultsResponse500
    | None
):
    """Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST,
    LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.

    Args:
        body (PostApiModelDefaultsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiModelDefaultsResponse200 | PostApiModelDefaultsResponse400 | PostApiModelDefaultsResponse401 | PostApiModelDefaultsResponse422 | PostApiModelDefaultsResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiModelDefaultsBody | Unset = UNSET,
) -> Response[
    PostApiModelDefaultsResponse200
    | PostApiModelDefaultsResponse400
    | PostApiModelDefaultsResponse401
    | PostApiModelDefaultsResponse422
    | PostApiModelDefaultsResponse500
]:
    """Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST,
    LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.

    Args:
        body (PostApiModelDefaultsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiModelDefaultsResponse200 | PostApiModelDefaultsResponse400 | PostApiModelDefaultsResponse401 | PostApiModelDefaultsResponse422 | PostApiModelDefaultsResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiModelDefaultsBody | Unset = UNSET,
) -> (
    PostApiModelDefaultsResponse200
    | PostApiModelDefaultsResponse400
    | PostApiModelDefaultsResponse401
    | PostApiModelDefaultsResponse422
    | PostApiModelDefaultsResponse500
    | None
):
    """Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST,
    LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.

    Args:
        body (PostApiModelDefaultsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiModelDefaultsResponse200 | PostApiModelDefaultsResponse400 | PostApiModelDefaultsResponse401 | PostApiModelDefaultsResponse422 | PostApiModelDefaultsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
