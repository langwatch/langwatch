from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_experiments_by_slug_workbench_state_body import PutApiExperimentsBySlugWorkbenchStateBody
from ...models.put_api_experiments_by_slug_workbench_state_response_200 import (
    PutApiExperimentsBySlugWorkbenchStateResponse200,
)
from ...models.put_api_experiments_by_slug_workbench_state_response_400 import (
    PutApiExperimentsBySlugWorkbenchStateResponse400,
)
from ...models.put_api_experiments_by_slug_workbench_state_response_401 import (
    PutApiExperimentsBySlugWorkbenchStateResponse401,
)
from ...models.put_api_experiments_by_slug_workbench_state_response_404 import (
    PutApiExperimentsBySlugWorkbenchStateResponse404,
)
from ...models.put_api_experiments_by_slug_workbench_state_response_409 import (
    PutApiExperimentsBySlugWorkbenchStateResponse409,
)
from ...types import Response, safe_http_status


def _get_kwargs(
    slug: str,
    *,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/experiments/{slug}/workbench-state".format(
            slug=quote(str(slug), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PutApiExperimentsBySlugWorkbenchStateResponse200
    | PutApiExperimentsBySlugWorkbenchStateResponse400
    | PutApiExperimentsBySlugWorkbenchStateResponse401
    | PutApiExperimentsBySlugWorkbenchStateResponse404
    | PutApiExperimentsBySlugWorkbenchStateResponse409
    | None
):
    if response.status_code == 200:
        response_200 = PutApiExperimentsBySlugWorkbenchStateResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiExperimentsBySlugWorkbenchStateResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PutApiExperimentsBySlugWorkbenchStateResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PutApiExperimentsBySlugWorkbenchStateResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PutApiExperimentsBySlugWorkbenchStateResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutApiExperimentsBySlugWorkbenchStateResponse200
    | PutApiExperimentsBySlugWorkbenchStateResponse400
    | PutApiExperimentsBySlugWorkbenchStateResponse401
    | PutApiExperimentsBySlugWorkbenchStateResponse404
    | PutApiExperimentsBySlugWorkbenchStateResponse409
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
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> Response[
    PutApiExperimentsBySlugWorkbenchStateResponse200
    | PutApiExperimentsBySlugWorkbenchStateResponse400
    | PutApiExperimentsBySlugWorkbenchStateResponse401
    | PutApiExperimentsBySlugWorkbenchStateResponse404
    | PutApiExperimentsBySlugWorkbenchStateResponse409
]:
    """Save an experiment's setup

     Replace the experiment's setup. Send `expectedVersion` with the version you read and the save is
    refused with a 409 when someone else wrote first, instead of overwriting their work.

    Args:
        slug (str):
        body (PutApiExperimentsBySlugWorkbenchStateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiExperimentsBySlugWorkbenchStateResponse200 | PutApiExperimentsBySlugWorkbenchStateResponse400 | PutApiExperimentsBySlugWorkbenchStateResponse401 | PutApiExperimentsBySlugWorkbenchStateResponse404 | PutApiExperimentsBySlugWorkbenchStateResponse409]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> (
    PutApiExperimentsBySlugWorkbenchStateResponse200
    | PutApiExperimentsBySlugWorkbenchStateResponse400
    | PutApiExperimentsBySlugWorkbenchStateResponse401
    | PutApiExperimentsBySlugWorkbenchStateResponse404
    | PutApiExperimentsBySlugWorkbenchStateResponse409
    | None
):
    """Save an experiment's setup

     Replace the experiment's setup. Send `expectedVersion` with the version you read and the save is
    refused with a 409 when someone else wrote first, instead of overwriting their work.

    Args:
        slug (str):
        body (PutApiExperimentsBySlugWorkbenchStateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiExperimentsBySlugWorkbenchStateResponse200 | PutApiExperimentsBySlugWorkbenchStateResponse400 | PutApiExperimentsBySlugWorkbenchStateResponse401 | PutApiExperimentsBySlugWorkbenchStateResponse404 | PutApiExperimentsBySlugWorkbenchStateResponse409
    """

    return sync_detailed(
        slug=slug,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> Response[
    PutApiExperimentsBySlugWorkbenchStateResponse200
    | PutApiExperimentsBySlugWorkbenchStateResponse400
    | PutApiExperimentsBySlugWorkbenchStateResponse401
    | PutApiExperimentsBySlugWorkbenchStateResponse404
    | PutApiExperimentsBySlugWorkbenchStateResponse409
]:
    """Save an experiment's setup

     Replace the experiment's setup. Send `expectedVersion` with the version you read and the save is
    refused with a 409 when someone else wrote first, instead of overwriting their work.

    Args:
        slug (str):
        body (PutApiExperimentsBySlugWorkbenchStateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiExperimentsBySlugWorkbenchStateResponse200 | PutApiExperimentsBySlugWorkbenchStateResponse400 | PutApiExperimentsBySlugWorkbenchStateResponse401 | PutApiExperimentsBySlugWorkbenchStateResponse404 | PutApiExperimentsBySlugWorkbenchStateResponse409]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> (
    PutApiExperimentsBySlugWorkbenchStateResponse200
    | PutApiExperimentsBySlugWorkbenchStateResponse400
    | PutApiExperimentsBySlugWorkbenchStateResponse401
    | PutApiExperimentsBySlugWorkbenchStateResponse404
    | PutApiExperimentsBySlugWorkbenchStateResponse409
    | None
):
    """Save an experiment's setup

     Replace the experiment's setup. Send `expectedVersion` with the version you read and the save is
    refused with a 409 when someone else wrote first, instead of overwriting their work.

    Args:
        slug (str):
        body (PutApiExperimentsBySlugWorkbenchStateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiExperimentsBySlugWorkbenchStateResponse200 | PutApiExperimentsBySlugWorkbenchStateResponse400 | PutApiExperimentsBySlugWorkbenchStateResponse401 | PutApiExperimentsBySlugWorkbenchStateResponse404 | PutApiExperimentsBySlugWorkbenchStateResponse409
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
            body=body,
        )
    ).parsed
