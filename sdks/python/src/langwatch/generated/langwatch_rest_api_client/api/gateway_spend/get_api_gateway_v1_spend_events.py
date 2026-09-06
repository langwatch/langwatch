from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_spend_events_response_200 import GetApiGatewayV1SpendEventsResponse200
from ...models.get_api_gateway_v1_spend_events_response_400 import GetApiGatewayV1SpendEventsResponse400
from ...models.get_api_gateway_v1_spend_events_response_401 import GetApiGatewayV1SpendEventsResponse401
from ...models.get_api_gateway_v1_spend_events_response_403 import GetApiGatewayV1SpendEventsResponse403
from ...models.get_api_gateway_v1_spend_events_response_500 import GetApiGatewayV1SpendEventsResponse500
from ...models.get_api_gateway_v1_spend_events_status import GetApiGatewayV1SpendEventsStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    project_id: list[str] | str | Unset = UNSET,
    team_id: list[str] | str | Unset = UNSET,
    external_id: list[str] | str | Unset = UNSET,
    virtual_key_id: list[str] | str | Unset = UNSET,
    end_user_id: list[str] | str | Unset = UNSET,
    principal_user_id: list[str] | str | Unset = UNSET,
    model: list[str] | str | Unset = UNSET,
    provider_key: list[str] | str | Unset = UNSET,
    request_type: list[str] | str | Unset = UNSET,
    label: list[str] | str | Unset = UNSET,
    metadata: list[str] | str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["from"] = from_

    params["to"] = to

    params["cursor"] = cursor

    params["limit"] = limit

    json_project_id: list[str] | str | Unset
    if isinstance(project_id, Unset):
        json_project_id = UNSET
    elif isinstance(project_id, list):
        json_project_id = project_id

    else:
        json_project_id = project_id
    params["project_id"] = json_project_id

    json_team_id: list[str] | str | Unset
    if isinstance(team_id, Unset):
        json_team_id = UNSET
    elif isinstance(team_id, list):
        json_team_id = team_id

    else:
        json_team_id = team_id
    params["team_id"] = json_team_id

    json_external_id: list[str] | str | Unset
    if isinstance(external_id, Unset):
        json_external_id = UNSET
    elif isinstance(external_id, list):
        json_external_id = external_id

    else:
        json_external_id = external_id
    params["external_id"] = json_external_id

    json_virtual_key_id: list[str] | str | Unset
    if isinstance(virtual_key_id, Unset):
        json_virtual_key_id = UNSET
    elif isinstance(virtual_key_id, list):
        json_virtual_key_id = virtual_key_id

    else:
        json_virtual_key_id = virtual_key_id
    params["virtual_key_id"] = json_virtual_key_id

    json_end_user_id: list[str] | str | Unset
    if isinstance(end_user_id, Unset):
        json_end_user_id = UNSET
    elif isinstance(end_user_id, list):
        json_end_user_id = end_user_id

    else:
        json_end_user_id = end_user_id
    params["end_user_id"] = json_end_user_id

    json_principal_user_id: list[str] | str | Unset
    if isinstance(principal_user_id, Unset):
        json_principal_user_id = UNSET
    elif isinstance(principal_user_id, list):
        json_principal_user_id = principal_user_id

    else:
        json_principal_user_id = principal_user_id
    params["principal_user_id"] = json_principal_user_id

    json_model: list[str] | str | Unset
    if isinstance(model, Unset):
        json_model = UNSET
    elif isinstance(model, list):
        json_model = model

    else:
        json_model = model
    params["model"] = json_model

    json_provider_key: list[str] | str | Unset
    if isinstance(provider_key, Unset):
        json_provider_key = UNSET
    elif isinstance(provider_key, list):
        json_provider_key = provider_key

    else:
        json_provider_key = provider_key
    params["provider_key"] = json_provider_key

    json_request_type: list[str] | str | Unset
    if isinstance(request_type, Unset):
        json_request_type = UNSET
    elif isinstance(request_type, list):
        json_request_type = request_type

    else:
        json_request_type = request_type
    params["request_type"] = json_request_type

    json_label: list[str] | str | Unset
    if isinstance(label, Unset):
        json_label = UNSET
    elif isinstance(label, list):
        json_label = label

    else:
        json_label = label
    params["label"] = json_label

    json_metadata: list[str] | str | Unset
    if isinstance(metadata, Unset):
        json_metadata = UNSET
    elif isinstance(metadata, list):
        json_metadata = metadata

    else:
        json_metadata = metadata
    params["metadata"] = json_metadata

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/gateway/v1/spend-events",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1SpendEventsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1SpendEventsResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1SpendEventsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1SpendEventsResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1SpendEventsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
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
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    project_id: list[str] | str | Unset = UNSET,
    team_id: list[str] | str | Unset = UNSET,
    external_id: list[str] | str | Unset = UNSET,
    virtual_key_id: list[str] | str | Unset = UNSET,
    end_user_id: list[str] | str | Unset = UNSET,
    principal_user_id: list[str] | str | Unset = UNSET,
    model: list[str] | str | Unset = UNSET,
    provider_key: list[str] | str | Unset = UNSET,
    request_type: list[str] | str | Unset = UNSET,
    label: list[str] | str | Unset = UNSET,
    metadata: list[str] | str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
]:
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days and Stripe meters 24h+ at the time of
    writing; both vendors own those numbers, so confirm the current one before you rely on it): re-
    pulling older ranges into a biller past its window can double-bill. Every filter here is accepted by
    /spend-summaries too, so a checksum that disagrees can be diffed on exactly the same narrowing; the
    one difference is `status=admitted`, which only this read answers, because an admitted request is
    still in flight and contributes no cost to a rollup. Repeat a filter to widen it (`model=a&model=b`
    matches either); name two different filters to narrow. `metadata` is written `key:value`, split on
    the first colon, and repeating a key widens that key. `team_id` and `external_id` name Postgres
    records and are resolved to the projects and keys they cover, so a team with no projects or an
    external id nobody minted answers with no spend rather than with everything.

    Args:
        from_ (int):  Example: 1782864000000.
        to (int):  Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        project_id (list[str] | str | Unset):
        team_id (list[str] | str | Unset):
        external_id (list[str] | str | Unset):
        virtual_key_id (list[str] | str | Unset):
        end_user_id (list[str] | str | Unset):
        principal_user_id (list[str] | str | Unset):
        model (list[str] | str | Unset):
        provider_key (list[str] | str | Unset):
        request_type (list[str] | str | Unset):
        label (list[str] | str | Unset):
        metadata (list[str] | str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500]
    """

    kwargs = _get_kwargs(
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
        project_id=project_id,
        team_id=team_id,
        external_id=external_id,
        virtual_key_id=virtual_key_id,
        end_user_id=end_user_id,
        principal_user_id=principal_user_id,
        model=model,
        provider_key=provider_key,
        request_type=request_type,
        label=label,
        metadata=metadata,
        status=status,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    project_id: list[str] | str | Unset = UNSET,
    team_id: list[str] | str | Unset = UNSET,
    external_id: list[str] | str | Unset = UNSET,
    virtual_key_id: list[str] | str | Unset = UNSET,
    end_user_id: list[str] | str | Unset = UNSET,
    principal_user_id: list[str] | str | Unset = UNSET,
    model: list[str] | str | Unset = UNSET,
    provider_key: list[str] | str | Unset = UNSET,
    request_type: list[str] | str | Unset = UNSET,
    label: list[str] | str | Unset = UNSET,
    metadata: list[str] | str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
    | None
):
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days and Stripe meters 24h+ at the time of
    writing; both vendors own those numbers, so confirm the current one before you rely on it): re-
    pulling older ranges into a biller past its window can double-bill. Every filter here is accepted by
    /spend-summaries too, so a checksum that disagrees can be diffed on exactly the same narrowing; the
    one difference is `status=admitted`, which only this read answers, because an admitted request is
    still in flight and contributes no cost to a rollup. Repeat a filter to widen it (`model=a&model=b`
    matches either); name two different filters to narrow. `metadata` is written `key:value`, split on
    the first colon, and repeating a key widens that key. `team_id` and `external_id` name Postgres
    records and are resolved to the projects and keys they cover, so a team with no projects or an
    external id nobody minted answers with no spend rather than with everything.

    Args:
        from_ (int):  Example: 1782864000000.
        to (int):  Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        project_id (list[str] | str | Unset):
        team_id (list[str] | str | Unset):
        external_id (list[str] | str | Unset):
        virtual_key_id (list[str] | str | Unset):
        end_user_id (list[str] | str | Unset):
        principal_user_id (list[str] | str | Unset):
        model (list[str] | str | Unset):
        provider_key (list[str] | str | Unset):
        request_type (list[str] | str | Unset):
        label (list[str] | str | Unset):
        metadata (list[str] | str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500
    """

    return sync_detailed(
        client=client,
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
        project_id=project_id,
        team_id=team_id,
        external_id=external_id,
        virtual_key_id=virtual_key_id,
        end_user_id=end_user_id,
        principal_user_id=principal_user_id,
        model=model,
        provider_key=provider_key,
        request_type=request_type,
        label=label,
        metadata=metadata,
        status=status,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    project_id: list[str] | str | Unset = UNSET,
    team_id: list[str] | str | Unset = UNSET,
    external_id: list[str] | str | Unset = UNSET,
    virtual_key_id: list[str] | str | Unset = UNSET,
    end_user_id: list[str] | str | Unset = UNSET,
    principal_user_id: list[str] | str | Unset = UNSET,
    model: list[str] | str | Unset = UNSET,
    provider_key: list[str] | str | Unset = UNSET,
    request_type: list[str] | str | Unset = UNSET,
    label: list[str] | str | Unset = UNSET,
    metadata: list[str] | str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
]:
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days and Stripe meters 24h+ at the time of
    writing; both vendors own those numbers, so confirm the current one before you rely on it): re-
    pulling older ranges into a biller past its window can double-bill. Every filter here is accepted by
    /spend-summaries too, so a checksum that disagrees can be diffed on exactly the same narrowing; the
    one difference is `status=admitted`, which only this read answers, because an admitted request is
    still in flight and contributes no cost to a rollup. Repeat a filter to widen it (`model=a&model=b`
    matches either); name two different filters to narrow. `metadata` is written `key:value`, split on
    the first colon, and repeating a key widens that key. `team_id` and `external_id` name Postgres
    records and are resolved to the projects and keys they cover, so a team with no projects or an
    external id nobody minted answers with no spend rather than with everything.

    Args:
        from_ (int):  Example: 1782864000000.
        to (int):  Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        project_id (list[str] | str | Unset):
        team_id (list[str] | str | Unset):
        external_id (list[str] | str | Unset):
        virtual_key_id (list[str] | str | Unset):
        end_user_id (list[str] | str | Unset):
        principal_user_id (list[str] | str | Unset):
        model (list[str] | str | Unset):
        provider_key (list[str] | str | Unset):
        request_type (list[str] | str | Unset):
        label (list[str] | str | Unset):
        metadata (list[str] | str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500]
    """

    kwargs = _get_kwargs(
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
        project_id=project_id,
        team_id=team_id,
        external_id=external_id,
        virtual_key_id=virtual_key_id,
        end_user_id=end_user_id,
        principal_user_id=principal_user_id,
        model=model,
        provider_key=provider_key,
        request_type=request_type,
        label=label,
        metadata=metadata,
        status=status,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 50,
    project_id: list[str] | str | Unset = UNSET,
    team_id: list[str] | str | Unset = UNSET,
    external_id: list[str] | str | Unset = UNSET,
    virtual_key_id: list[str] | str | Unset = UNSET,
    end_user_id: list[str] | str | Unset = UNSET,
    principal_user_id: list[str] | str | Unset = UNSET,
    model: list[str] | str | Unset = UNSET,
    provider_key: list[str] | str | Unset = UNSET,
    request_type: list[str] | str | Unset = UNSET,
    label: list[str] | str | Unset = UNSET,
    metadata: list[str] | str | Unset = UNSET,
    status: GetApiGatewayV1SpendEventsStatus | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendEventsResponse200
    | GetApiGatewayV1SpendEventsResponse400
    | GetApiGatewayV1SpendEventsResponse401
    | GetApiGatewayV1SpendEventsResponse403
    | GetApiGatewayV1SpendEventsResponse500
    | None
):
    """List spend events

     Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late
    are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries
    carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a
    downstream biller, mind its dedup window (Metronome 34 days and Stripe meters 24h+ at the time of
    writing; both vendors own those numbers, so confirm the current one before you rely on it): re-
    pulling older ranges into a biller past its window can double-bill. Every filter here is accepted by
    /spend-summaries too, so a checksum that disagrees can be diffed on exactly the same narrowing; the
    one difference is `status=admitted`, which only this read answers, because an admitted request is
    still in flight and contributes no cost to a rollup. Repeat a filter to widen it (`model=a&model=b`
    matches either); name two different filters to narrow. `metadata` is written `key:value`, split on
    the first colon, and repeating a key widens that key. `team_id` and `external_id` name Postgres
    records and are resolved to the projects and keys they cover, so a team with no projects or an
    external id nobody minted answers with no spend rather than with everything.

    Args:
        from_ (int):  Example: 1782864000000.
        to (int):  Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 50.
        project_id (list[str] | str | Unset):
        team_id (list[str] | str | Unset):
        external_id (list[str] | str | Unset):
        virtual_key_id (list[str] | str | Unset):
        end_user_id (list[str] | str | Unset):
        principal_user_id (list[str] | str | Unset):
        model (list[str] | str | Unset):
        provider_key (list[str] | str | Unset):
        request_type (list[str] | str | Unset):
        label (list[str] | str | Unset):
        metadata (list[str] | str | Unset):
        status (GetApiGatewayV1SpendEventsStatus | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendEventsResponse200 | GetApiGatewayV1SpendEventsResponse400 | GetApiGatewayV1SpendEventsResponse401 | GetApiGatewayV1SpendEventsResponse403 | GetApiGatewayV1SpendEventsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            from_=from_,
            to=to,
            cursor=cursor,
            limit=limit,
            project_id=project_id,
            team_id=team_id,
            external_id=external_id,
            virtual_key_id=virtual_key_id,
            end_user_id=end_user_id,
            principal_user_id=principal_user_id,
            model=model,
            provider_key=provider_key,
            request_type=request_type,
            label=label,
            metadata=metadata,
            status=status,
        )
    ).parsed
