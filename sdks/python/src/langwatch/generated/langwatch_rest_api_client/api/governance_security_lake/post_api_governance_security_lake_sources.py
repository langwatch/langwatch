from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_security_lake_sources_body import PostApiGovernanceSecurityLakeSourcesBody
from ...models.post_api_governance_security_lake_sources_response_200 import (
    PostApiGovernanceSecurityLakeSourcesResponse200,
)
from ...models.post_api_governance_security_lake_sources_response_400 import (
    PostApiGovernanceSecurityLakeSourcesResponse400,
)
from ...models.post_api_governance_security_lake_sources_response_401 import (
    PostApiGovernanceSecurityLakeSourcesResponse401,
)
from ...models.post_api_governance_security_lake_sources_response_403 import (
    PostApiGovernanceSecurityLakeSourcesResponse403,
)
from ...models.post_api_governance_security_lake_sources_response_422 import (
    PostApiGovernanceSecurityLakeSourcesResponse422,
)
from ...models.post_api_governance_security_lake_sources_response_500 import (
    PostApiGovernanceSecurityLakeSourcesResponse500,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    *,
    body: PostApiGovernanceSecurityLakeSourcesBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/security-lake/sources",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiGovernanceSecurityLakeSourcesResponse200
    | PostApiGovernanceSecurityLakeSourcesResponse400
    | PostApiGovernanceSecurityLakeSourcesResponse401
    | PostApiGovernanceSecurityLakeSourcesResponse403
    | PostApiGovernanceSecurityLakeSourcesResponse422
    | PostApiGovernanceSecurityLakeSourcesResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGovernanceSecurityLakeSourcesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGovernanceSecurityLakeSourcesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceSecurityLakeSourcesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceSecurityLakeSourcesResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = PostApiGovernanceSecurityLakeSourcesResponse422.from_dict(response.json())

        return response_422

    if response.status_code == 500:
        response_500 = PostApiGovernanceSecurityLakeSourcesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceSecurityLakeSourcesResponse200
    | PostApiGovernanceSecurityLakeSourcesResponse400
    | PostApiGovernanceSecurityLakeSourcesResponse401
    | PostApiGovernanceSecurityLakeSourcesResponse403
    | PostApiGovernanceSecurityLakeSourcesResponse422
    | PostApiGovernanceSecurityLakeSourcesResponse500
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
    body: PostApiGovernanceSecurityLakeSourcesBody,
) -> Response[
    PostApiGovernanceSecurityLakeSourcesResponse200
    | PostApiGovernanceSecurityLakeSourcesResponse400
    | PostApiGovernanceSecurityLakeSourcesResponse401
    | PostApiGovernanceSecurityLakeSourcesResponse403
    | PostApiGovernanceSecurityLakeSourcesResponse422
    | PostApiGovernanceSecurityLakeSourcesResponse500
]:
    """Add an AWS Security Lake source

     Adds a Security Lake subscriber as an ingestion source. LangWatch reads the subscriber's SQS queue
    on `config.schedule` (every 5 minutes by default), decodes each Parquet object, keeps the AI
    activity (Bedrock, SageMaker endpoints, Bedrock agents) and stores it as OCSF events with
    `source_type` `security_lake`. The access keys are stored sealed and never returned. LangWatch
    generates the source's `externalId` and returns it; the subscriber role's trust policy must require
    it as the `sts:ExternalId` condition.

    Args:
        body (PostApiGovernanceSecurityLakeSourcesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceSecurityLakeSourcesResponse200 | PostApiGovernanceSecurityLakeSourcesResponse400 | PostApiGovernanceSecurityLakeSourcesResponse401 | PostApiGovernanceSecurityLakeSourcesResponse403 | PostApiGovernanceSecurityLakeSourcesResponse422 | PostApiGovernanceSecurityLakeSourcesResponse500]
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
    body: PostApiGovernanceSecurityLakeSourcesBody,
) -> (
    PostApiGovernanceSecurityLakeSourcesResponse200
    | PostApiGovernanceSecurityLakeSourcesResponse400
    | PostApiGovernanceSecurityLakeSourcesResponse401
    | PostApiGovernanceSecurityLakeSourcesResponse403
    | PostApiGovernanceSecurityLakeSourcesResponse422
    | PostApiGovernanceSecurityLakeSourcesResponse500
    | None
):
    """Add an AWS Security Lake source

     Adds a Security Lake subscriber as an ingestion source. LangWatch reads the subscriber's SQS queue
    on `config.schedule` (every 5 minutes by default), decodes each Parquet object, keeps the AI
    activity (Bedrock, SageMaker endpoints, Bedrock agents) and stores it as OCSF events with
    `source_type` `security_lake`. The access keys are stored sealed and never returned. LangWatch
    generates the source's `externalId` and returns it; the subscriber role's trust policy must require
    it as the `sts:ExternalId` condition.

    Args:
        body (PostApiGovernanceSecurityLakeSourcesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceSecurityLakeSourcesResponse200 | PostApiGovernanceSecurityLakeSourcesResponse400 | PostApiGovernanceSecurityLakeSourcesResponse401 | PostApiGovernanceSecurityLakeSourcesResponse403 | PostApiGovernanceSecurityLakeSourcesResponse422 | PostApiGovernanceSecurityLakeSourcesResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceSecurityLakeSourcesBody,
) -> Response[
    PostApiGovernanceSecurityLakeSourcesResponse200
    | PostApiGovernanceSecurityLakeSourcesResponse400
    | PostApiGovernanceSecurityLakeSourcesResponse401
    | PostApiGovernanceSecurityLakeSourcesResponse403
    | PostApiGovernanceSecurityLakeSourcesResponse422
    | PostApiGovernanceSecurityLakeSourcesResponse500
]:
    """Add an AWS Security Lake source

     Adds a Security Lake subscriber as an ingestion source. LangWatch reads the subscriber's SQS queue
    on `config.schedule` (every 5 minutes by default), decodes each Parquet object, keeps the AI
    activity (Bedrock, SageMaker endpoints, Bedrock agents) and stores it as OCSF events with
    `source_type` `security_lake`. The access keys are stored sealed and never returned. LangWatch
    generates the source's `externalId` and returns it; the subscriber role's trust policy must require
    it as the `sts:ExternalId` condition.

    Args:
        body (PostApiGovernanceSecurityLakeSourcesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceSecurityLakeSourcesResponse200 | PostApiGovernanceSecurityLakeSourcesResponse400 | PostApiGovernanceSecurityLakeSourcesResponse401 | PostApiGovernanceSecurityLakeSourcesResponse403 | PostApiGovernanceSecurityLakeSourcesResponse422 | PostApiGovernanceSecurityLakeSourcesResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceSecurityLakeSourcesBody,
) -> (
    PostApiGovernanceSecurityLakeSourcesResponse200
    | PostApiGovernanceSecurityLakeSourcesResponse400
    | PostApiGovernanceSecurityLakeSourcesResponse401
    | PostApiGovernanceSecurityLakeSourcesResponse403
    | PostApiGovernanceSecurityLakeSourcesResponse422
    | PostApiGovernanceSecurityLakeSourcesResponse500
    | None
):
    """Add an AWS Security Lake source

     Adds a Security Lake subscriber as an ingestion source. LangWatch reads the subscriber's SQS queue
    on `config.schedule` (every 5 minutes by default), decodes each Parquet object, keeps the AI
    activity (Bedrock, SageMaker endpoints, Bedrock agents) and stores it as OCSF events with
    `source_type` `security_lake`. The access keys are stored sealed and never returned. LangWatch
    generates the source's `externalId` and returns it; the subscriber role's trust policy must require
    it as the `sts:ExternalId` condition.

    Args:
        body (PostApiGovernanceSecurityLakeSourcesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceSecurityLakeSourcesResponse200 | PostApiGovernanceSecurityLakeSourcesResponse400 | PostApiGovernanceSecurityLakeSourcesResponse401 | PostApiGovernanceSecurityLakeSourcesResponse403 | PostApiGovernanceSecurityLakeSourcesResponse422 | PostApiGovernanceSecurityLakeSourcesResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
