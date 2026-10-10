from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_by_slug_workbench_state_response_200 import (
    GetApiExperimentsBySlugWorkbenchStateResponse200,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    slug: str,
    *,
    fields: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["fields"] = fields

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/experiments/{slug}/workbench-state".format(
            slug=quote(str(slug), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | GetApiExperimentsBySlugWorkbenchStateResponse200 | None:
    if response.status_code == 200:
        response_200 = GetApiExperimentsBySlugWorkbenchStateResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 401:
        response_401 = cast(Any, None)
        return response_401

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | GetApiExperimentsBySlugWorkbenchStateResponse200]:
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
    fields: str | Unset = UNSET,
) -> Response[Any | GetApiExperimentsBySlugWorkbenchStateResponse200]:
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiExperimentsBySlugWorkbenchStateResponse200]
    """

    kwargs = _get_kwargs(
        slug=slug,
        fields=fields,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    slug: str,
    *,
    client: AuthenticatedClient,
    fields: str | Unset = UNSET,
) -> Any | GetApiExperimentsBySlugWorkbenchStateResponse200 | None:
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiExperimentsBySlugWorkbenchStateResponse200
    """

    return sync_detailed(
        slug=slug,
        client=client,
        fields=fields,
    ).parsed


async def asyncio_detailed(
    slug: str,
    *,
    client: AuthenticatedClient,
    fields: str | Unset = UNSET,
) -> Response[Any | GetApiExperimentsBySlugWorkbenchStateResponse200]:
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiExperimentsBySlugWorkbenchStateResponse200]
    """

    kwargs = _get_kwargs(
        slug=slug,
        fields=fields,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    slug: str,
    *,
    client: AuthenticatedClient,
    fields: str | Unset = UNSET,
) -> Any | GetApiExperimentsBySlugWorkbenchStateResponse200 | None:
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiExperimentsBySlugWorkbenchStateResponse200
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
            fields=fields,
        )
    ).parsed
