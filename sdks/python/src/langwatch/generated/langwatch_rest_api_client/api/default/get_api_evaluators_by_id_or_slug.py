from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_evaluators_by_id_or_slug_response_200 import GetApiEvaluatorsByIdOrSlugResponse200
from ...models.get_api_evaluators_by_id_or_slug_response_404 import GetApiEvaluatorsByIdOrSlugResponse404
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id_or_slug: str,
    *,
    label: str | Unset = UNSET,
    version: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["label"] = label

    params["version"] = version

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/evaluators/{id_or_slug}".format(
            id_or_slug=quote(str(id_or_slug), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404 | None:
    if response.status_code == 200:
        response_200 = GetApiEvaluatorsByIdOrSlugResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetApiEvaluatorsByIdOrSlugResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404]:
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
    id_or_slug: str,
    *,
    client: AuthenticatedClient,
    label: str | Unset = UNSET,
    version: int | Unset = UNSET,
) -> Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404]:
    """Get a specific evaluator by ID or slug, at the latest version unless `label` or `version` is given.
    The address also takes a suffix: `toxicity:production`, `toxicity:2` or `toxicity:latest`.

    Args:
        id_or_slug (str):
        label (str | Unset):
        version (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404]
    """

    kwargs = _get_kwargs(
        id_or_slug=id_or_slug,
        label=label,
        version=version,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id_or_slug: str,
    *,
    client: AuthenticatedClient,
    label: str | Unset = UNSET,
    version: int | Unset = UNSET,
) -> GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404 | None:
    """Get a specific evaluator by ID or slug, at the latest version unless `label` or `version` is given.
    The address also takes a suffix: `toxicity:production`, `toxicity:2` or `toxicity:latest`.

    Args:
        id_or_slug (str):
        label (str | Unset):
        version (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404
    """

    return sync_detailed(
        id_or_slug=id_or_slug,
        client=client,
        label=label,
        version=version,
    ).parsed


async def asyncio_detailed(
    id_or_slug: str,
    *,
    client: AuthenticatedClient,
    label: str | Unset = UNSET,
    version: int | Unset = UNSET,
) -> Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404]:
    """Get a specific evaluator by ID or slug, at the latest version unless `label` or `version` is given.
    The address also takes a suffix: `toxicity:production`, `toxicity:2` or `toxicity:latest`.

    Args:
        id_or_slug (str):
        label (str | Unset):
        version (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404]
    """

    kwargs = _get_kwargs(
        id_or_slug=id_or_slug,
        label=label,
        version=version,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id_or_slug: str,
    *,
    client: AuthenticatedClient,
    label: str | Unset = UNSET,
    version: int | Unset = UNSET,
) -> GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404 | None:
    """Get a specific evaluator by ID or slug, at the latest version unless `label` or `version` is given.
    The address also takes a suffix: `toxicity:production`, `toxicity:2` or `toxicity:latest`.

    Args:
        id_or_slug (str):
        label (str | Unset):
        version (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiEvaluatorsByIdOrSlugResponse200 | GetApiEvaluatorsByIdOrSlugResponse404
    """

    return (
        await asyncio_detailed(
            id_or_slug=id_or_slug,
            client=client,
            label=label,
            version=version,
        )
    ).parsed
