from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_200 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse200,
)
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_400 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse400,
)
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_401 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse401,
)
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_403 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse403,
)
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_404 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse404,
)
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_412 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse412,
)
from ...models.get_api_gateway_v1_virtual_keys_by_id_spend_response_500 import (
    GetApiGatewayV1VirtualKeysByIdSpendResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["from"] = from_

    params["to"] = to

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/virtual-keys/{id}/spend".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1VirtualKeysByIdSpendResponse200
    | GetApiGatewayV1VirtualKeysByIdSpendResponse400
    | GetApiGatewayV1VirtualKeysByIdSpendResponse401
    | GetApiGatewayV1VirtualKeysByIdSpendResponse403
    | GetApiGatewayV1VirtualKeysByIdSpendResponse404
    | GetApiGatewayV1VirtualKeysByIdSpendResponse412
    | GetApiGatewayV1VirtualKeysByIdSpendResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1VirtualKeysByIdSpendResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1VirtualKeysByIdSpendResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1VirtualKeysByIdSpendResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1VirtualKeysByIdSpendResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = GetApiGatewayV1VirtualKeysByIdSpendResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 412:
        response_412 = GetApiGatewayV1VirtualKeysByIdSpendResponse412.from_dict(response.json())

        return response_412

    if response.status_code == 500:
        response_500 = GetApiGatewayV1VirtualKeysByIdSpendResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1VirtualKeysByIdSpendResponse200
    | GetApiGatewayV1VirtualKeysByIdSpendResponse400
    | GetApiGatewayV1VirtualKeysByIdSpendResponse401
    | GetApiGatewayV1VirtualKeysByIdSpendResponse403
    | GetApiGatewayV1VirtualKeysByIdSpendResponse404
    | GetApiGatewayV1VirtualKeysByIdSpendResponse412
    | GetApiGatewayV1VirtualKeysByIdSpendResponse500
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
    client: AuthenticatedClient | Client,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
) -> Response[
    GetApiGatewayV1VirtualKeysByIdSpendResponse200
    | GetApiGatewayV1VirtualKeysByIdSpendResponse400
    | GetApiGatewayV1VirtualKeysByIdSpendResponse401
    | GetApiGatewayV1VirtualKeysByIdSpendResponse403
    | GetApiGatewayV1VirtualKeysByIdSpendResponse404
    | GetApiGatewayV1VirtualKeysByIdSpendResponse412
    | GetApiGatewayV1VirtualKeysByIdSpendResponse500
]:
    """Read a virtual key's spend

     Aggregate spend and request count for one key over a window given in epoch milliseconds (default:
    current UTC calendar month). Reads the cost path (`trace_summaries`) — the same source the
    dashboard's key list and Usage tab read — so this number, the UI column, and the Usage page agree by
    construction. Returns 412 `spend_source_unavailable` on deploys without a ClickHouse spend source
    rather than a $0.00 that cannot be told apart from a zero-spend key.

    Args:
        id (str):
        from_ (int | Unset):
        to (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1VirtualKeysByIdSpendResponse200 | GetApiGatewayV1VirtualKeysByIdSpendResponse400 | GetApiGatewayV1VirtualKeysByIdSpendResponse401 | GetApiGatewayV1VirtualKeysByIdSpendResponse403 | GetApiGatewayV1VirtualKeysByIdSpendResponse404 | GetApiGatewayV1VirtualKeysByIdSpendResponse412 | GetApiGatewayV1VirtualKeysByIdSpendResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        from_=from_,
        to=to,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
) -> (
    GetApiGatewayV1VirtualKeysByIdSpendResponse200
    | GetApiGatewayV1VirtualKeysByIdSpendResponse400
    | GetApiGatewayV1VirtualKeysByIdSpendResponse401
    | GetApiGatewayV1VirtualKeysByIdSpendResponse403
    | GetApiGatewayV1VirtualKeysByIdSpendResponse404
    | GetApiGatewayV1VirtualKeysByIdSpendResponse412
    | GetApiGatewayV1VirtualKeysByIdSpendResponse500
    | None
):
    """Read a virtual key's spend

     Aggregate spend and request count for one key over a window given in epoch milliseconds (default:
    current UTC calendar month). Reads the cost path (`trace_summaries`) — the same source the
    dashboard's key list and Usage tab read — so this number, the UI column, and the Usage page agree by
    construction. Returns 412 `spend_source_unavailable` on deploys without a ClickHouse spend source
    rather than a $0.00 that cannot be told apart from a zero-spend key.

    Args:
        id (str):
        from_ (int | Unset):
        to (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1VirtualKeysByIdSpendResponse200 | GetApiGatewayV1VirtualKeysByIdSpendResponse400 | GetApiGatewayV1VirtualKeysByIdSpendResponse401 | GetApiGatewayV1VirtualKeysByIdSpendResponse403 | GetApiGatewayV1VirtualKeysByIdSpendResponse404 | GetApiGatewayV1VirtualKeysByIdSpendResponse412 | GetApiGatewayV1VirtualKeysByIdSpendResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        from_=from_,
        to=to,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
) -> Response[
    GetApiGatewayV1VirtualKeysByIdSpendResponse200
    | GetApiGatewayV1VirtualKeysByIdSpendResponse400
    | GetApiGatewayV1VirtualKeysByIdSpendResponse401
    | GetApiGatewayV1VirtualKeysByIdSpendResponse403
    | GetApiGatewayV1VirtualKeysByIdSpendResponse404
    | GetApiGatewayV1VirtualKeysByIdSpendResponse412
    | GetApiGatewayV1VirtualKeysByIdSpendResponse500
]:
    """Read a virtual key's spend

     Aggregate spend and request count for one key over a window given in epoch milliseconds (default:
    current UTC calendar month). Reads the cost path (`trace_summaries`) — the same source the
    dashboard's key list and Usage tab read — so this number, the UI column, and the Usage page agree by
    construction. Returns 412 `spend_source_unavailable` on deploys without a ClickHouse spend source
    rather than a $0.00 that cannot be told apart from a zero-spend key.

    Args:
        id (str):
        from_ (int | Unset):
        to (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1VirtualKeysByIdSpendResponse200 | GetApiGatewayV1VirtualKeysByIdSpendResponse400 | GetApiGatewayV1VirtualKeysByIdSpendResponse401 | GetApiGatewayV1VirtualKeysByIdSpendResponse403 | GetApiGatewayV1VirtualKeysByIdSpendResponse404 | GetApiGatewayV1VirtualKeysByIdSpendResponse412 | GetApiGatewayV1VirtualKeysByIdSpendResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        from_=from_,
        to=to,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
) -> (
    GetApiGatewayV1VirtualKeysByIdSpendResponse200
    | GetApiGatewayV1VirtualKeysByIdSpendResponse400
    | GetApiGatewayV1VirtualKeysByIdSpendResponse401
    | GetApiGatewayV1VirtualKeysByIdSpendResponse403
    | GetApiGatewayV1VirtualKeysByIdSpendResponse404
    | GetApiGatewayV1VirtualKeysByIdSpendResponse412
    | GetApiGatewayV1VirtualKeysByIdSpendResponse500
    | None
):
    """Read a virtual key's spend

     Aggregate spend and request count for one key over a window given in epoch milliseconds (default:
    current UTC calendar month). Reads the cost path (`trace_summaries`) — the same source the
    dashboard's key list and Usage tab read — so this number, the UI column, and the Usage page agree by
    construction. Returns 412 `spend_source_unavailable` on deploys without a ClickHouse spend source
    rather than a $0.00 that cannot be told apart from a zero-spend key.

    Args:
        id (str):
        from_ (int | Unset):
        to (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1VirtualKeysByIdSpendResponse200 | GetApiGatewayV1VirtualKeysByIdSpendResponse400 | GetApiGatewayV1VirtualKeysByIdSpendResponse401 | GetApiGatewayV1VirtualKeysByIdSpendResponse403 | GetApiGatewayV1VirtualKeysByIdSpendResponse404 | GetApiGatewayV1VirtualKeysByIdSpendResponse412 | GetApiGatewayV1VirtualKeysByIdSpendResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            from_=from_,
            to=to,
        )
    ).parsed
