from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_end_users_by_id_spend_response_200 import GetApiGatewayV1EndUsersByIdSpendResponse200
from ...models.get_api_gateway_v1_end_users_by_id_spend_response_400 import GetApiGatewayV1EndUsersByIdSpendResponse400
from ...models.get_api_gateway_v1_end_users_by_id_spend_response_401 import GetApiGatewayV1EndUsersByIdSpendResponse401
from ...models.get_api_gateway_v1_end_users_by_id_spend_response_403 import GetApiGatewayV1EndUsersByIdSpendResponse403
from ...models.get_api_gateway_v1_end_users_by_id_spend_response_500 import GetApiGatewayV1EndUsersByIdSpendResponse500
from ...models.get_api_gateway_v1_end_users_by_id_spend_window import GetApiGatewayV1EndUsersByIdSpendWindow
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    window: GetApiGatewayV1EndUsersByIdSpendWindow | Unset = GetApiGatewayV1EndUsersByIdSpendWindow.MONTH,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    virtual_key_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_window: str | Unset = UNSET
    if not isinstance(window, Unset):
        json_window = window.value

    params["window"] = json_window

    params["from"] = from_

    params["to"] = to

    params["virtual_key_id"] = virtual_key_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/end-users/{id}/spend".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1EndUsersByIdSpendResponse200
    | GetApiGatewayV1EndUsersByIdSpendResponse400
    | GetApiGatewayV1EndUsersByIdSpendResponse401
    | GetApiGatewayV1EndUsersByIdSpendResponse403
    | GetApiGatewayV1EndUsersByIdSpendResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1EndUsersByIdSpendResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1EndUsersByIdSpendResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1EndUsersByIdSpendResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1EndUsersByIdSpendResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1EndUsersByIdSpendResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1EndUsersByIdSpendResponse200
    | GetApiGatewayV1EndUsersByIdSpendResponse400
    | GetApiGatewayV1EndUsersByIdSpendResponse401
    | GetApiGatewayV1EndUsersByIdSpendResponse403
    | GetApiGatewayV1EndUsersByIdSpendResponse500
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
    window: GetApiGatewayV1EndUsersByIdSpendWindow | Unset = GetApiGatewayV1EndUsersByIdSpendWindow.MONTH,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    virtual_key_id: str | Unset = UNSET,
) -> Response[
    GetApiGatewayV1EndUsersByIdSpendResponse200
    | GetApiGatewayV1EndUsersByIdSpendResponse400
    | GetApiGatewayV1EndUsersByIdSpendResponse401
    | GetApiGatewayV1EndUsersByIdSpendResponse403
    | GetApiGatewayV1EndUsersByIdSpendResponse500
]:
    """Read one end user's spend

     Windowed spend rollup for one external end user across the organization (the /customer/info-style
    read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this
    end user, each with its limit and the spend against it. It is an empty array until such a budget
    template applies, never null.

    Args:
        id (str):
        window (GetApiGatewayV1EndUsersByIdSpendWindow | Unset):  Default:
            GetApiGatewayV1EndUsersByIdSpendWindow.MONTH.
        from_ (int | Unset):
        to (int | Unset):
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1EndUsersByIdSpendResponse200 | GetApiGatewayV1EndUsersByIdSpendResponse400 | GetApiGatewayV1EndUsersByIdSpendResponse401 | GetApiGatewayV1EndUsersByIdSpendResponse403 | GetApiGatewayV1EndUsersByIdSpendResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        window=window,
        from_=from_,
        to=to,
        virtual_key_id=virtual_key_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    window: GetApiGatewayV1EndUsersByIdSpendWindow | Unset = GetApiGatewayV1EndUsersByIdSpendWindow.MONTH,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    virtual_key_id: str | Unset = UNSET,
) -> (
    GetApiGatewayV1EndUsersByIdSpendResponse200
    | GetApiGatewayV1EndUsersByIdSpendResponse400
    | GetApiGatewayV1EndUsersByIdSpendResponse401
    | GetApiGatewayV1EndUsersByIdSpendResponse403
    | GetApiGatewayV1EndUsersByIdSpendResponse500
    | None
):
    """Read one end user's spend

     Windowed spend rollup for one external end user across the organization (the /customer/info-style
    read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this
    end user, each with its limit and the spend against it. It is an empty array until such a budget
    template applies, never null.

    Args:
        id (str):
        window (GetApiGatewayV1EndUsersByIdSpendWindow | Unset):  Default:
            GetApiGatewayV1EndUsersByIdSpendWindow.MONTH.
        from_ (int | Unset):
        to (int | Unset):
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1EndUsersByIdSpendResponse200 | GetApiGatewayV1EndUsersByIdSpendResponse400 | GetApiGatewayV1EndUsersByIdSpendResponse401 | GetApiGatewayV1EndUsersByIdSpendResponse403 | GetApiGatewayV1EndUsersByIdSpendResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        window=window,
        from_=from_,
        to=to,
        virtual_key_id=virtual_key_id,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    window: GetApiGatewayV1EndUsersByIdSpendWindow | Unset = GetApiGatewayV1EndUsersByIdSpendWindow.MONTH,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    virtual_key_id: str | Unset = UNSET,
) -> Response[
    GetApiGatewayV1EndUsersByIdSpendResponse200
    | GetApiGatewayV1EndUsersByIdSpendResponse400
    | GetApiGatewayV1EndUsersByIdSpendResponse401
    | GetApiGatewayV1EndUsersByIdSpendResponse403
    | GetApiGatewayV1EndUsersByIdSpendResponse500
]:
    """Read one end user's spend

     Windowed spend rollup for one external end user across the organization (the /customer/info-style
    read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this
    end user, each with its limit and the spend against it. It is an empty array until such a budget
    template applies, never null.

    Args:
        id (str):
        window (GetApiGatewayV1EndUsersByIdSpendWindow | Unset):  Default:
            GetApiGatewayV1EndUsersByIdSpendWindow.MONTH.
        from_ (int | Unset):
        to (int | Unset):
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1EndUsersByIdSpendResponse200 | GetApiGatewayV1EndUsersByIdSpendResponse400 | GetApiGatewayV1EndUsersByIdSpendResponse401 | GetApiGatewayV1EndUsersByIdSpendResponse403 | GetApiGatewayV1EndUsersByIdSpendResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        window=window,
        from_=from_,
        to=to,
        virtual_key_id=virtual_key_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    window: GetApiGatewayV1EndUsersByIdSpendWindow | Unset = GetApiGatewayV1EndUsersByIdSpendWindow.MONTH,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    virtual_key_id: str | Unset = UNSET,
) -> (
    GetApiGatewayV1EndUsersByIdSpendResponse200
    | GetApiGatewayV1EndUsersByIdSpendResponse400
    | GetApiGatewayV1EndUsersByIdSpendResponse401
    | GetApiGatewayV1EndUsersByIdSpendResponse403
    | GetApiGatewayV1EndUsersByIdSpendResponse500
    | None
):
    """Read one end user's spend

     Windowed spend rollup for one external end user across the organization (the /customer/info-style
    read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this
    end user, each with its limit and the spend against it. It is an empty array until such a budget
    template applies, never null.

    Args:
        id (str):
        window (GetApiGatewayV1EndUsersByIdSpendWindow | Unset):  Default:
            GetApiGatewayV1EndUsersByIdSpendWindow.MONTH.
        from_ (int | Unset):
        to (int | Unset):
        virtual_key_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1EndUsersByIdSpendResponse200 | GetApiGatewayV1EndUsersByIdSpendResponse400 | GetApiGatewayV1EndUsersByIdSpendResponse401 | GetApiGatewayV1EndUsersByIdSpendResponse403 | GetApiGatewayV1EndUsersByIdSpendResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            window=window,
            from_=from_,
            to=to,
            virtual_key_id=virtual_key_id,
        )
    ).parsed
