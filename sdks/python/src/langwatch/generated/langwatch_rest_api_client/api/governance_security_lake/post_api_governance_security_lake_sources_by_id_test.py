from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_governance_security_lake_sources_by_id_test_body import (
    PostApiGovernanceSecurityLakeSourcesByIdTestBody,
)
from ...models.post_api_governance_security_lake_sources_by_id_test_response_200 import (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200,
)
from ...models.post_api_governance_security_lake_sources_by_id_test_response_400 import (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse400,
)
from ...models.post_api_governance_security_lake_sources_by_id_test_response_401 import (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse401,
)
from ...models.post_api_governance_security_lake_sources_by_id_test_response_403 import (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse403,
)
from ...models.post_api_governance_security_lake_sources_by_id_test_response_500 import (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse500,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    source_id: str,
    *,
    body: PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/governance/security-lake/sources/{source_id}/test".format(
            source_id=quote(str(source_id), safe=""),
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
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostApiGovernanceSecurityLakeSourcesByIdTestResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostApiGovernanceSecurityLakeSourcesByIdTestResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiGovernanceSecurityLakeSourcesByIdTestResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiGovernanceSecurityLakeSourcesByIdTestResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = PostApiGovernanceSecurityLakeSourcesByIdTestResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
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
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset = UNSET,
) -> Response[
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
]:
    """Test a Security Lake source's connection

     Reads the subscriber queue's backlog without taking a message. Settings and keys in the body are
    tested over the stored ones and not saved; an empty body tests the stored source. `ok` is false with
    the AWS error code when the queue refused or could not be reached.

    Args:
        source_id (str):
        body (PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceSecurityLakeSourcesByIdTestResponse200 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset = UNSET,
) -> (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
    | None
):
    """Test a Security Lake source's connection

     Reads the subscriber queue's backlog without taking a message. Settings and keys in the body are
    tested over the stored ones and not saved; an empty body tests the stored source. `ok` is false with
    the AWS error code when the queue refused or could not be reached.

    Args:
        source_id (str):
        body (PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceSecurityLakeSourcesByIdTestResponse200 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
    """

    return sync_detailed(
        source_id=source_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset = UNSET,
) -> Response[
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
]:
    """Test a Security Lake source's connection

     Reads the subscriber queue's backlog without taking a message. Settings and keys in the body are
    tested over the stored ones and not saved; an empty body tests the stored source. `ok` is false with
    the AWS error code when the queue refused or could not be reached.

    Args:
        source_id (str):
        body (PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiGovernanceSecurityLakeSourcesByIdTestResponse200 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500]
    """

    kwargs = _get_kwargs(
        source_id=source_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    source_id: str,
    *,
    client: AuthenticatedClient,
    body: PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset = UNSET,
) -> (
    PostApiGovernanceSecurityLakeSourcesByIdTestResponse200
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403
    | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
    | None
):
    """Test a Security Lake source's connection

     Reads the subscriber queue's backlog without taking a message. Settings and keys in the body are
    tested over the stored ones and not saved; an empty body tests the stored source. `ok` is false with
    the AWS error code when the queue refused or could not be reached.

    Args:
        source_id (str):
        body (PostApiGovernanceSecurityLakeSourcesByIdTestBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiGovernanceSecurityLakeSourcesByIdTestResponse200 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse400 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse401 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse403 | PostApiGovernanceSecurityLakeSourcesByIdTestResponse500
    """

    return (
        await asyncio_detailed(
            source_id=source_id,
            client=client,
            body=body,
        )
    ).parsed
