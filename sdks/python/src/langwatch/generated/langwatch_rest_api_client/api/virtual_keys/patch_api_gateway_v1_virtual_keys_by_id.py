from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_api_gateway_v1_virtual_keys_by_id_body import PatchApiGatewayV1VirtualKeysByIdBody
from ...models.patch_api_gateway_v1_virtual_keys_by_id_response_200 import PatchApiGatewayV1VirtualKeysByIdResponse200
from ...models.patch_api_gateway_v1_virtual_keys_by_id_response_400 import PatchApiGatewayV1VirtualKeysByIdResponse400
from ...models.patch_api_gateway_v1_virtual_keys_by_id_response_401 import PatchApiGatewayV1VirtualKeysByIdResponse401
from ...models.patch_api_gateway_v1_virtual_keys_by_id_response_403 import PatchApiGatewayV1VirtualKeysByIdResponse403
from ...models.patch_api_gateway_v1_virtual_keys_by_id_response_500 import PatchApiGatewayV1VirtualKeysByIdResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    body: PatchApiGatewayV1VirtualKeysByIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/gateway/v1/virtual-keys/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchApiGatewayV1VirtualKeysByIdResponse200
    | PatchApiGatewayV1VirtualKeysByIdResponse400
    | PatchApiGatewayV1VirtualKeysByIdResponse401
    | PatchApiGatewayV1VirtualKeysByIdResponse403
    | PatchApiGatewayV1VirtualKeysByIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PatchApiGatewayV1VirtualKeysByIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PatchApiGatewayV1VirtualKeysByIdResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PatchApiGatewayV1VirtualKeysByIdResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PatchApiGatewayV1VirtualKeysByIdResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PatchApiGatewayV1VirtualKeysByIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PatchApiGatewayV1VirtualKeysByIdResponse200
    | PatchApiGatewayV1VirtualKeysByIdResponse400
    | PatchApiGatewayV1VirtualKeysByIdResponse401
    | PatchApiGatewayV1VirtualKeysByIdResponse403
    | PatchApiGatewayV1VirtualKeysByIdResponse500
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
    id: str,
    *,
    client: AuthenticatedClient,
    body: PatchApiGatewayV1VirtualKeysByIdBody | Unset = UNSET,
) -> Response[
    PatchApiGatewayV1VirtualKeysByIdResponse200
    | PatchApiGatewayV1VirtualKeysByIdResponse400
    | PatchApiGatewayV1VirtualKeysByIdResponse401
    | PatchApiGatewayV1VirtualKeysByIdResponse403
    | PatchApiGatewayV1VirtualKeysByIdResponse500
]:
    """Update virtual key

     Partial update: send only the fields you want to change. `scopes` replaces the entire visibility set
    and requires `virtualKeys:manage` at every NEW scope, and does NOT move where the key's traces and
    costs land: send `trace_project_id` for that, validated the way create validates it; explicit null
    re-resolves it under the create-time rules rather than clearing it. `config` is deep-merged.
    `budget` upserts the key's own cap; explicit null archives it.

    Args:
        id (str):
        body (PatchApiGatewayV1VirtualKeysByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGatewayV1VirtualKeysByIdResponse200 | PatchApiGatewayV1VirtualKeysByIdResponse400 | PatchApiGatewayV1VirtualKeysByIdResponse401 | PatchApiGatewayV1VirtualKeysByIdResponse403 | PatchApiGatewayV1VirtualKeysByIdResponse500]
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
    body: PatchApiGatewayV1VirtualKeysByIdBody | Unset = UNSET,
) -> (
    PatchApiGatewayV1VirtualKeysByIdResponse200
    | PatchApiGatewayV1VirtualKeysByIdResponse400
    | PatchApiGatewayV1VirtualKeysByIdResponse401
    | PatchApiGatewayV1VirtualKeysByIdResponse403
    | PatchApiGatewayV1VirtualKeysByIdResponse500
    | None
):
    """Update virtual key

     Partial update: send only the fields you want to change. `scopes` replaces the entire visibility set
    and requires `virtualKeys:manage` at every NEW scope, and does NOT move where the key's traces and
    costs land: send `trace_project_id` for that, validated the way create validates it; explicit null
    re-resolves it under the create-time rules rather than clearing it. `config` is deep-merged.
    `budget` upserts the key's own cap; explicit null archives it.

    Args:
        id (str):
        body (PatchApiGatewayV1VirtualKeysByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGatewayV1VirtualKeysByIdResponse200 | PatchApiGatewayV1VirtualKeysByIdResponse400 | PatchApiGatewayV1VirtualKeysByIdResponse401 | PatchApiGatewayV1VirtualKeysByIdResponse403 | PatchApiGatewayV1VirtualKeysByIdResponse500
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
    body: PatchApiGatewayV1VirtualKeysByIdBody | Unset = UNSET,
) -> Response[
    PatchApiGatewayV1VirtualKeysByIdResponse200
    | PatchApiGatewayV1VirtualKeysByIdResponse400
    | PatchApiGatewayV1VirtualKeysByIdResponse401
    | PatchApiGatewayV1VirtualKeysByIdResponse403
    | PatchApiGatewayV1VirtualKeysByIdResponse500
]:
    """Update virtual key

     Partial update: send only the fields you want to change. `scopes` replaces the entire visibility set
    and requires `virtualKeys:manage` at every NEW scope, and does NOT move where the key's traces and
    costs land: send `trace_project_id` for that, validated the way create validates it; explicit null
    re-resolves it under the create-time rules rather than clearing it. `config` is deep-merged.
    `budget` upserts the key's own cap; explicit null archives it.

    Args:
        id (str):
        body (PatchApiGatewayV1VirtualKeysByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchApiGatewayV1VirtualKeysByIdResponse200 | PatchApiGatewayV1VirtualKeysByIdResponse400 | PatchApiGatewayV1VirtualKeysByIdResponse401 | PatchApiGatewayV1VirtualKeysByIdResponse403 | PatchApiGatewayV1VirtualKeysByIdResponse500]
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
    body: PatchApiGatewayV1VirtualKeysByIdBody | Unset = UNSET,
) -> (
    PatchApiGatewayV1VirtualKeysByIdResponse200
    | PatchApiGatewayV1VirtualKeysByIdResponse400
    | PatchApiGatewayV1VirtualKeysByIdResponse401
    | PatchApiGatewayV1VirtualKeysByIdResponse403
    | PatchApiGatewayV1VirtualKeysByIdResponse500
    | None
):
    """Update virtual key

     Partial update: send only the fields you want to change. `scopes` replaces the entire visibility set
    and requires `virtualKeys:manage` at every NEW scope, and does NOT move where the key's traces and
    costs land: send `trace_project_id` for that, validated the way create validates it; explicit null
    re-resolves it under the create-time rules rather than clearing it. `config` is deep-merged.
    `budget` upserts the key's own cap; explicit null archives it.

    Args:
        id (str):
        body (PatchApiGatewayV1VirtualKeysByIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchApiGatewayV1VirtualKeysByIdResponse200 | PatchApiGatewayV1VirtualKeysByIdResponse400 | PatchApiGatewayV1VirtualKeysByIdResponse401 | PatchApiGatewayV1VirtualKeysByIdResponse403 | PatchApiGatewayV1VirtualKeysByIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
