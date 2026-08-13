from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_gateway_v1_spend_summaries_bucket import GetApiGatewayV1SpendSummariesBucket
from ...models.get_api_gateway_v1_spend_summaries_response_200 import GetApiGatewayV1SpendSummariesResponse200
from ...models.get_api_gateway_v1_spend_summaries_response_400 import GetApiGatewayV1SpendSummariesResponse400
from ...models.get_api_gateway_v1_spend_summaries_response_401 import GetApiGatewayV1SpendSummariesResponse401
from ...models.get_api_gateway_v1_spend_summaries_response_403 import GetApiGatewayV1SpendSummariesResponse403
from ...models.get_api_gateway_v1_spend_summaries_response_500 import GetApiGatewayV1SpendSummariesResponse500
from ...models.get_api_gateway_v1_spend_summaries_status import GetApiGatewayV1SpendSummariesStatus
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    *,
    group_by: str,
    bucket: GetApiGatewayV1SpendSummariesBucket | Unset = GetApiGatewayV1SpendSummariesBucket.NONE,
    timezone: str | Unset = "UTC",
    allow_unstable: str | Unset = "false",
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
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
    status: GetApiGatewayV1SpendSummariesStatus | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["group_by"] = group_by

    json_bucket: str | Unset = UNSET
    if not isinstance(bucket, Unset):
        json_bucket = bucket.value

    params["bucket"] = json_bucket

    params["timezone"] = timezone

    params["allow_unstable"] = allow_unstable

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
        "url": "/api/gateway/v1/spend-summaries",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiGatewayV1SpendSummariesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiGatewayV1SpendSummariesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiGatewayV1SpendSummariesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiGatewayV1SpendSummariesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiGatewayV1SpendSummariesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
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
    group_by: str,
    bucket: GetApiGatewayV1SpendSummariesBucket | Unset = GetApiGatewayV1SpendSummariesBucket.NONE,
    timezone: str | Unset = "UTC",
    allow_unstable: str | Unset = "false",
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
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
    status: GetApiGatewayV1SpendSummariesStatus | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
]:
    """List spend summaries

     Reconciliation checksum fast path: spend rollups with token classes and integer nano-USD cost.
    Settled (unpriced) requests are counted separately as settled_count and never included in cost sums.
    Diff individual items via /spend-events only when a checksum diverges. `group_by` takes one or two
    of virtual_key, end_user, project, model, provider, principal and request_type, comma-separated, and
    `bucket` adds an hour or day column in the `timezone` you name. `key` stays the first dimension's
    value for consumers written against the single-dimension surface; read `group` to tell two
    dimensions apart. Paged by group key ascending: follow next_cursor until it comes back null, because
    a page that is full does not mean the window held nothing more. Grouping by model or provider, or
    into time buckets, is refused with `gateway_spend_group_by_unstable` while the window is recent
    enough that outcomes can still arrive, because those groups can move under a page walk and the
    totals would double-count some requests and miss others; ask for an older range, or send
    `allow_unstable` when an approximate shape is enough. Every filter here is accepted by /spend-events
    too, and the reverse holds apart from `status=admitted`: a rollup sums the cost of requests past
    admission, so an admitted request has none to contribute and that narrowing is refused rather than
    answered with a zero. Ask /spend-events for those.

    Args:
        group_by (str): One or two dimensions, comma separated: virtual_key, end_user, project,
            model, provider, principal, request_type. A dimension may not repeat. Each row's `key` is
            the first dimension's value and `group` names them all, so two rows may share a key.
            Example: model,end_user.
        bucket (GetApiGatewayV1SpendSummariesBucket | Unset):  Default:
            GetApiGatewayV1SpendSummariesBucket.NONE.
        timezone (str | Unset):  Default: 'UTC'.
        allow_unstable (str | Unset): true, 1, yes for yes; false, 0, no or omitted for no. Case
            does not matter, so a Python True is accepted as sent. Default: 'false'. Example: true.
        from_ (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a
            valid integer here and answers for 1970, so a mismatched unit reads as an empty window
            rather than as an error. Example: 1782864000000.
        to (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a valid
            integer here and answers for 1970, so a mismatched unit reads as an empty window rather
            than as an error. Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
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
        status (GetApiGatewayV1SpendSummariesStatus | Unset): Narrow to one lifecycle status.
            `admitted` is not accepted here: a rollup sums the cost of requests past admission, and an
            admitted request is still in flight with no cost of its own yet. Ask /spend-events for
            those.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500]
    """

    kwargs = _get_kwargs(
        group_by=group_by,
        bucket=bucket,
        timezone=timezone,
        allow_unstable=allow_unstable,
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
    group_by: str,
    bucket: GetApiGatewayV1SpendSummariesBucket | Unset = GetApiGatewayV1SpendSummariesBucket.NONE,
    timezone: str | Unset = "UTC",
    allow_unstable: str | Unset = "false",
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
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
    status: GetApiGatewayV1SpendSummariesStatus | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
    | None
):
    """List spend summaries

     Reconciliation checksum fast path: spend rollups with token classes and integer nano-USD cost.
    Settled (unpriced) requests are counted separately as settled_count and never included in cost sums.
    Diff individual items via /spend-events only when a checksum diverges. `group_by` takes one or two
    of virtual_key, end_user, project, model, provider, principal and request_type, comma-separated, and
    `bucket` adds an hour or day column in the `timezone` you name. `key` stays the first dimension's
    value for consumers written against the single-dimension surface; read `group` to tell two
    dimensions apart. Paged by group key ascending: follow next_cursor until it comes back null, because
    a page that is full does not mean the window held nothing more. Grouping by model or provider, or
    into time buckets, is refused with `gateway_spend_group_by_unstable` while the window is recent
    enough that outcomes can still arrive, because those groups can move under a page walk and the
    totals would double-count some requests and miss others; ask for an older range, or send
    `allow_unstable` when an approximate shape is enough. Every filter here is accepted by /spend-events
    too, and the reverse holds apart from `status=admitted`: a rollup sums the cost of requests past
    admission, so an admitted request has none to contribute and that narrowing is refused rather than
    answered with a zero. Ask /spend-events for those.

    Args:
        group_by (str): One or two dimensions, comma separated: virtual_key, end_user, project,
            model, provider, principal, request_type. A dimension may not repeat. Each row's `key` is
            the first dimension's value and `group` names them all, so two rows may share a key.
            Example: model,end_user.
        bucket (GetApiGatewayV1SpendSummariesBucket | Unset):  Default:
            GetApiGatewayV1SpendSummariesBucket.NONE.
        timezone (str | Unset):  Default: 'UTC'.
        allow_unstable (str | Unset): true, 1, yes for yes; false, 0, no or omitted for no. Case
            does not matter, so a Python True is accepted as sent. Default: 'false'. Example: true.
        from_ (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a
            valid integer here and answers for 1970, so a mismatched unit reads as an empty window
            rather than as an error. Example: 1782864000000.
        to (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a valid
            integer here and answers for 1970, so a mismatched unit reads as an empty window rather
            than as an error. Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
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
        status (GetApiGatewayV1SpendSummariesStatus | Unset): Narrow to one lifecycle status.
            `admitted` is not accepted here: a rollup sums the cost of requests past admission, and an
            admitted request is still in flight with no cost of its own yet. Ask /spend-events for
            those.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500
    """

    return sync_detailed(
        client=client,
        group_by=group_by,
        bucket=bucket,
        timezone=timezone,
        allow_unstable=allow_unstable,
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
    group_by: str,
    bucket: GetApiGatewayV1SpendSummariesBucket | Unset = GetApiGatewayV1SpendSummariesBucket.NONE,
    timezone: str | Unset = "UTC",
    allow_unstable: str | Unset = "false",
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
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
    status: GetApiGatewayV1SpendSummariesStatus | Unset = UNSET,
) -> Response[
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
]:
    """List spend summaries

     Reconciliation checksum fast path: spend rollups with token classes and integer nano-USD cost.
    Settled (unpriced) requests are counted separately as settled_count and never included in cost sums.
    Diff individual items via /spend-events only when a checksum diverges. `group_by` takes one or two
    of virtual_key, end_user, project, model, provider, principal and request_type, comma-separated, and
    `bucket` adds an hour or day column in the `timezone` you name. `key` stays the first dimension's
    value for consumers written against the single-dimension surface; read `group` to tell two
    dimensions apart. Paged by group key ascending: follow next_cursor until it comes back null, because
    a page that is full does not mean the window held nothing more. Grouping by model or provider, or
    into time buckets, is refused with `gateway_spend_group_by_unstable` while the window is recent
    enough that outcomes can still arrive, because those groups can move under a page walk and the
    totals would double-count some requests and miss others; ask for an older range, or send
    `allow_unstable` when an approximate shape is enough. Every filter here is accepted by /spend-events
    too, and the reverse holds apart from `status=admitted`: a rollup sums the cost of requests past
    admission, so an admitted request has none to contribute and that narrowing is refused rather than
    answered with a zero. Ask /spend-events for those.

    Args:
        group_by (str): One or two dimensions, comma separated: virtual_key, end_user, project,
            model, provider, principal, request_type. A dimension may not repeat. Each row's `key` is
            the first dimension's value and `group` names them all, so two rows may share a key.
            Example: model,end_user.
        bucket (GetApiGatewayV1SpendSummariesBucket | Unset):  Default:
            GetApiGatewayV1SpendSummariesBucket.NONE.
        timezone (str | Unset):  Default: 'UTC'.
        allow_unstable (str | Unset): true, 1, yes for yes; false, 0, no or omitted for no. Case
            does not matter, so a Python True is accepted as sent. Default: 'false'. Example: true.
        from_ (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a
            valid integer here and answers for 1970, so a mismatched unit reads as an empty window
            rather than as an error. Example: 1782864000000.
        to (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a valid
            integer here and answers for 1970, so a mismatched unit reads as an empty window rather
            than as an error. Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
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
        status (GetApiGatewayV1SpendSummariesStatus | Unset): Narrow to one lifecycle status.
            `admitted` is not accepted here: a rollup sums the cost of requests past admission, and an
            admitted request is still in flight with no cost of its own yet. Ask /spend-events for
            those.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500]
    """

    kwargs = _get_kwargs(
        group_by=group_by,
        bucket=bucket,
        timezone=timezone,
        allow_unstable=allow_unstable,
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
    group_by: str,
    bucket: GetApiGatewayV1SpendSummariesBucket | Unset = GetApiGatewayV1SpendSummariesBucket.NONE,
    timezone: str | Unset = "UTC",
    allow_unstable: str | Unset = "false",
    from_: int,
    to: int,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 500,
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
    status: GetApiGatewayV1SpendSummariesStatus | Unset = UNSET,
) -> (
    GetApiGatewayV1SpendSummariesResponse200
    | GetApiGatewayV1SpendSummariesResponse400
    | GetApiGatewayV1SpendSummariesResponse401
    | GetApiGatewayV1SpendSummariesResponse403
    | GetApiGatewayV1SpendSummariesResponse500
    | None
):
    """List spend summaries

     Reconciliation checksum fast path: spend rollups with token classes and integer nano-USD cost.
    Settled (unpriced) requests are counted separately as settled_count and never included in cost sums.
    Diff individual items via /spend-events only when a checksum diverges. `group_by` takes one or two
    of virtual_key, end_user, project, model, provider, principal and request_type, comma-separated, and
    `bucket` adds an hour or day column in the `timezone` you name. `key` stays the first dimension's
    value for consumers written against the single-dimension surface; read `group` to tell two
    dimensions apart. Paged by group key ascending: follow next_cursor until it comes back null, because
    a page that is full does not mean the window held nothing more. Grouping by model or provider, or
    into time buckets, is refused with `gateway_spend_group_by_unstable` while the window is recent
    enough that outcomes can still arrive, because those groups can move under a page walk and the
    totals would double-count some requests and miss others; ask for an older range, or send
    `allow_unstable` when an approximate shape is enough. Every filter here is accepted by /spend-events
    too, and the reverse holds apart from `status=admitted`: a rollup sums the cost of requests past
    admission, so an admitted request has none to contribute and that narrowing is refused rather than
    answered with a zero. Ask /spend-events for those.

    Args:
        group_by (str): One or two dimensions, comma separated: virtual_key, end_user, project,
            model, provider, principal, request_type. A dimension may not repeat. Each row's `key` is
            the first dimension's value and `group` names them all, so two rows may share a key.
            Example: model,end_user.
        bucket (GetApiGatewayV1SpendSummariesBucket | Unset):  Default:
            GetApiGatewayV1SpendSummariesBucket.NONE.
        timezone (str | Unset):  Default: 'UTC'.
        allow_unstable (str | Unset): true, 1, yes for yes; false, 0, no or omitted for no. Case
            does not matter, so a Python True is accepted as sent. Default: 'false'. Example: true.
        from_ (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a
            valid integer here and answers for 1970, so a mismatched unit reads as an empty window
            rather than as an error. Example: 1782864000000.
        to (int): Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a valid
            integer here and answers for 1970, so a mismatched unit reads as an empty window rather
            than as an error. Example: 1782864000000.
        cursor (str | Unset):
        limit (int | Unset):  Default: 500.
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
        status (GetApiGatewayV1SpendSummariesStatus | Unset): Narrow to one lifecycle status.
            `admitted` is not accepted here: a rollup sums the cost of requests past admission, and an
            admitted request is still in flight with no cost of its own yet. Ask /spend-events for
            those.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiGatewayV1SpendSummariesResponse200 | GetApiGatewayV1SpendSummariesResponse400 | GetApiGatewayV1SpendSummariesResponse401 | GetApiGatewayV1SpendSummariesResponse403 | GetApiGatewayV1SpendSummariesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            group_by=group_by,
            bucket=bucket,
            timezone=timezone,
            allow_unstable=allow_unstable,
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
