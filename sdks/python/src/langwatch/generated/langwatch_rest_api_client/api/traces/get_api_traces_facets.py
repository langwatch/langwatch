from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_traces_facets_response_200_type_0 import GetApiTracesFacetsResponse200Type0
from ...models.get_api_traces_facets_response_200_type_1 import GetApiTracesFacetsResponse200Type1
from ...models.get_api_traces_facets_response_400 import GetApiTracesFacetsResponse400
from ...models.get_api_traces_facets_response_401 import GetApiTracesFacetsResponse401
from ...models.get_api_traces_facets_response_403 import GetApiTracesFacetsResponse403
from ...models.get_api_traces_facets_response_422 import GetApiTracesFacetsResponse422
from ...models.get_api_traces_facets_response_500 import GetApiTracesFacetsResponse500
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    field: str | Unset = UNSET,
    prefix: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
    start_date: str | Unset = UNSET,
    end_date: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["field"] = field

    params["prefix"] = prefix

    params["limit"] = limit

    params["offset"] = offset

    params["startDate"] = start_date

    params["endDate"] = end_date

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/traces/facets",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiTracesFacetsResponse200Type0
    | GetApiTracesFacetsResponse200Type1
    | GetApiTracesFacetsResponse400
    | GetApiTracesFacetsResponse401
    | GetApiTracesFacetsResponse403
    | GetApiTracesFacetsResponse422
    | GetApiTracesFacetsResponse500
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> GetApiTracesFacetsResponse200Type0 | GetApiTracesFacetsResponse200Type1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = GetApiTracesFacetsResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = GetApiTracesFacetsResponse200Type1.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiTracesFacetsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiTracesFacetsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiTracesFacetsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = GetApiTracesFacetsResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = GetApiTracesFacetsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiTracesFacetsResponse200Type0
    | GetApiTracesFacetsResponse200Type1
    | GetApiTracesFacetsResponse400
    | GetApiTracesFacetsResponse401
    | GetApiTracesFacetsResponse403
    | GetApiTracesFacetsResponse422
    | GetApiTracesFacetsResponse500
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
    field: str | Unset = UNSET,
    prefix: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
    start_date: str | Unset = UNSET,
    end_date: str | Unset = UNSET,
) -> Response[
    GetApiTracesFacetsResponse200Type0
    | GetApiTracesFacetsResponse200Type1
    | GetApiTracesFacetsResponse400
    | GetApiTracesFacetsResponse401
    | GetApiTracesFacetsResponse403
    | GetApiTracesFacetsResponse422
    | GetApiTracesFacetsResponse500
]:
    """Discover what the trace filter fields hold

     What the trace filter fields actually hold in THIS project, which the filter language's own
    reference deliberately does not carry: values are tenant data, they move under you, and reading them
    all costs about thirty aggregate queries.

    Two answers from one door. Without `field` you get the discovery payload: every facet this project
    has, each with its top values and counts, plus the range bounds for the numeric ones. With `field`
    you get one field's values, paged, filtered by `prefix`.

    The values are cached and refreshed in the background, so a cold project answers `pending: true`
    with the payload it has; call again shortly for the computed one.

    Use it whenever you are unsure how a value is spelled. `GET /api/v1/query/reference` lists the
    fields and their fixed vocabularies; only this endpoint knows the open ones.

    Args:
        field (str | Unset):
        prefix (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
        start_date (str | Unset):
        end_date (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTracesFacetsResponse200Type0 | GetApiTracesFacetsResponse200Type1 | GetApiTracesFacetsResponse400 | GetApiTracesFacetsResponse401 | GetApiTracesFacetsResponse403 | GetApiTracesFacetsResponse422 | GetApiTracesFacetsResponse500]
    """

    kwargs = _get_kwargs(
        field=field,
        prefix=prefix,
        limit=limit,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    field: str | Unset = UNSET,
    prefix: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
    start_date: str | Unset = UNSET,
    end_date: str | Unset = UNSET,
) -> (
    GetApiTracesFacetsResponse200Type0
    | GetApiTracesFacetsResponse200Type1
    | GetApiTracesFacetsResponse400
    | GetApiTracesFacetsResponse401
    | GetApiTracesFacetsResponse403
    | GetApiTracesFacetsResponse422
    | GetApiTracesFacetsResponse500
    | None
):
    """Discover what the trace filter fields hold

     What the trace filter fields actually hold in THIS project, which the filter language's own
    reference deliberately does not carry: values are tenant data, they move under you, and reading them
    all costs about thirty aggregate queries.

    Two answers from one door. Without `field` you get the discovery payload: every facet this project
    has, each with its top values and counts, plus the range bounds for the numeric ones. With `field`
    you get one field's values, paged, filtered by `prefix`.

    The values are cached and refreshed in the background, so a cold project answers `pending: true`
    with the payload it has; call again shortly for the computed one.

    Use it whenever you are unsure how a value is spelled. `GET /api/v1/query/reference` lists the
    fields and their fixed vocabularies; only this endpoint knows the open ones.

    Args:
        field (str | Unset):
        prefix (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
        start_date (str | Unset):
        end_date (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTracesFacetsResponse200Type0 | GetApiTracesFacetsResponse200Type1 | GetApiTracesFacetsResponse400 | GetApiTracesFacetsResponse401 | GetApiTracesFacetsResponse403 | GetApiTracesFacetsResponse422 | GetApiTracesFacetsResponse500
    """

    return sync_detailed(
        client=client,
        field=field,
        prefix=prefix,
        limit=limit,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    field: str | Unset = UNSET,
    prefix: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
    start_date: str | Unset = UNSET,
    end_date: str | Unset = UNSET,
) -> Response[
    GetApiTracesFacetsResponse200Type0
    | GetApiTracesFacetsResponse200Type1
    | GetApiTracesFacetsResponse400
    | GetApiTracesFacetsResponse401
    | GetApiTracesFacetsResponse403
    | GetApiTracesFacetsResponse422
    | GetApiTracesFacetsResponse500
]:
    """Discover what the trace filter fields hold

     What the trace filter fields actually hold in THIS project, which the filter language's own
    reference deliberately does not carry: values are tenant data, they move under you, and reading them
    all costs about thirty aggregate queries.

    Two answers from one door. Without `field` you get the discovery payload: every facet this project
    has, each with its top values and counts, plus the range bounds for the numeric ones. With `field`
    you get one field's values, paged, filtered by `prefix`.

    The values are cached and refreshed in the background, so a cold project answers `pending: true`
    with the payload it has; call again shortly for the computed one.

    Use it whenever you are unsure how a value is spelled. `GET /api/v1/query/reference` lists the
    fields and their fixed vocabularies; only this endpoint knows the open ones.

    Args:
        field (str | Unset):
        prefix (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
        start_date (str | Unset):
        end_date (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiTracesFacetsResponse200Type0 | GetApiTracesFacetsResponse200Type1 | GetApiTracesFacetsResponse400 | GetApiTracesFacetsResponse401 | GetApiTracesFacetsResponse403 | GetApiTracesFacetsResponse422 | GetApiTracesFacetsResponse500]
    """

    kwargs = _get_kwargs(
        field=field,
        prefix=prefix,
        limit=limit,
        offset=offset,
        start_date=start_date,
        end_date=end_date,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    field: str | Unset = UNSET,
    prefix: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
    start_date: str | Unset = UNSET,
    end_date: str | Unset = UNSET,
) -> (
    GetApiTracesFacetsResponse200Type0
    | GetApiTracesFacetsResponse200Type1
    | GetApiTracesFacetsResponse400
    | GetApiTracesFacetsResponse401
    | GetApiTracesFacetsResponse403
    | GetApiTracesFacetsResponse422
    | GetApiTracesFacetsResponse500
    | None
):
    """Discover what the trace filter fields hold

     What the trace filter fields actually hold in THIS project, which the filter language's own
    reference deliberately does not carry: values are tenant data, they move under you, and reading them
    all costs about thirty aggregate queries.

    Two answers from one door. Without `field` you get the discovery payload: every facet this project
    has, each with its top values and counts, plus the range bounds for the numeric ones. With `field`
    you get one field's values, paged, filtered by `prefix`.

    The values are cached and refreshed in the background, so a cold project answers `pending: true`
    with the payload it has; call again shortly for the computed one.

    Use it whenever you are unsure how a value is spelled. `GET /api/v1/query/reference` lists the
    fields and their fixed vocabularies; only this endpoint knows the open ones.

    Args:
        field (str | Unset):
        prefix (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
        start_date (str | Unset):
        end_date (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiTracesFacetsResponse200Type0 | GetApiTracesFacetsResponse200Type1 | GetApiTracesFacetsResponse400 | GetApiTracesFacetsResponse401 | GetApiTracesFacetsResponse403 | GetApiTracesFacetsResponse422 | GetApiTracesFacetsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            field=field,
            prefix=prefix,
            limit=limit,
            offset=offset,
            start_date=start_date,
            end_date=end_date,
        )
    ).parsed
