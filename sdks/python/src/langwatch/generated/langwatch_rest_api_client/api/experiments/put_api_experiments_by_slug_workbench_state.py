from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_experiments_by_slug_workbench_state_body import PutApiExperimentsBySlugWorkbenchStateBody
from ...types import Response, safe_http_status


def _get_kwargs(
    slug: str,
    *,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/experiments/{slug}/workbench-state".format(
            slug=quote(str(slug), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if response.status_code == 400:
        return None

    if response.status_code == 401:
        return None

    if response.status_code == 404:
        return None

    if response.status_code == 409:
        return None

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
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
) -> Response[Any]:
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
        Response[Any]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    body: PutApiExperimentsBySlugWorkbenchStateBody,
) -> Response[Any]:
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
        Response[Any]
    """

    kwargs = _get_kwargs(
        slug=slug,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
