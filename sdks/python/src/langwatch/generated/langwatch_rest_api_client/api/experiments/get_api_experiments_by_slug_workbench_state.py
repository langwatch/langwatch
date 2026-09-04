from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_experiments_by_slug_workbench_state_fields import GetApiExperimentsBySlugWorkbenchStateFields
from ...models.get_api_experiments_by_slug_workbench_state_response_200_type_0 import (
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0,
)
from ...models.get_api_experiments_by_slug_workbench_state_response_200_type_1 import (
    GetApiExperimentsBySlugWorkbenchStateResponse200Type1,
)
from ...models.get_api_experiments_by_slug_workbench_state_response_400 import (
    GetApiExperimentsBySlugWorkbenchStateResponse400,
)
from ...models.get_api_experiments_by_slug_workbench_state_response_401 import (
    GetApiExperimentsBySlugWorkbenchStateResponse401,
)
from ...models.get_api_experiments_by_slug_workbench_state_response_404 import (
    GetApiExperimentsBySlugWorkbenchStateResponse404,
)
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    slug: str,
    *,
    fields: GetApiExperimentsBySlugWorkbenchStateFields | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_fields: str | Unset = UNSET
    if not isinstance(fields, Unset):
        json_fields = fields.value

    params["fields"] = json_fields

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/experiments/{slug}/workbench-state".format(
            slug=quote(str(slug), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0
    | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
    | GetApiExperimentsBySlugWorkbenchStateResponse400
    | GetApiExperimentsBySlugWorkbenchStateResponse401
    | GetApiExperimentsBySlugWorkbenchStateResponse404
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            GetApiExperimentsBySlugWorkbenchStateResponse200Type0
            | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = GetApiExperimentsBySlugWorkbenchStateResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = GetApiExperimentsBySlugWorkbenchStateResponse200Type1.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiExperimentsBySlugWorkbenchStateResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiExperimentsBySlugWorkbenchStateResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiExperimentsBySlugWorkbenchStateResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0
    | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
    | GetApiExperimentsBySlugWorkbenchStateResponse400
    | GetApiExperimentsBySlugWorkbenchStateResponse401
    | GetApiExperimentsBySlugWorkbenchStateResponse404
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
    fields: GetApiExperimentsBySlugWorkbenchStateFields | Unset = UNSET,
) -> Response[
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0
    | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
    | GetApiExperimentsBySlugWorkbenchStateResponse400
    | GetApiExperimentsBySlugWorkbenchStateResponse401
    | GetApiExperimentsBySlugWorkbenchStateResponse404
]:
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (GetApiExperimentsBySlugWorkbenchStateFields | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsBySlugWorkbenchStateResponse200Type0 | GetApiExperimentsBySlugWorkbenchStateResponse200Type1 | GetApiExperimentsBySlugWorkbenchStateResponse400 | GetApiExperimentsBySlugWorkbenchStateResponse401 | GetApiExperimentsBySlugWorkbenchStateResponse404]
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
    fields: GetApiExperimentsBySlugWorkbenchStateFields | Unset = UNSET,
) -> (
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0
    | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
    | GetApiExperimentsBySlugWorkbenchStateResponse400
    | GetApiExperimentsBySlugWorkbenchStateResponse401
    | GetApiExperimentsBySlugWorkbenchStateResponse404
    | None
):
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (GetApiExperimentsBySlugWorkbenchStateFields | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsBySlugWorkbenchStateResponse200Type0 | GetApiExperimentsBySlugWorkbenchStateResponse200Type1 | GetApiExperimentsBySlugWorkbenchStateResponse400 | GetApiExperimentsBySlugWorkbenchStateResponse401 | GetApiExperimentsBySlugWorkbenchStateResponse404
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
    fields: GetApiExperimentsBySlugWorkbenchStateFields | Unset = UNSET,
) -> Response[
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0
    | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
    | GetApiExperimentsBySlugWorkbenchStateResponse400
    | GetApiExperimentsBySlugWorkbenchStateResponse401
    | GetApiExperimentsBySlugWorkbenchStateResponse404
]:
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (GetApiExperimentsBySlugWorkbenchStateFields | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiExperimentsBySlugWorkbenchStateResponse200Type0 | GetApiExperimentsBySlugWorkbenchStateResponse200Type1 | GetApiExperimentsBySlugWorkbenchStateResponse400 | GetApiExperimentsBySlugWorkbenchStateResponse401 | GetApiExperimentsBySlugWorkbenchStateResponse404]
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
    fields: GetApiExperimentsBySlugWorkbenchStateFields | Unset = UNSET,
) -> (
    GetApiExperimentsBySlugWorkbenchStateResponse200Type0
    | GetApiExperimentsBySlugWorkbenchStateResponse200Type1
    | GetApiExperimentsBySlugWorkbenchStateResponse400
    | GetApiExperimentsBySlugWorkbenchStateResponse401
    | GetApiExperimentsBySlugWorkbenchStateResponse404
    | None
):
    """Read an experiment's setup

     The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask
    for `fields=version` to check for changes without transferring the setup.

    Args:
        slug (str):
        fields (GetApiExperimentsBySlugWorkbenchStateFields | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiExperimentsBySlugWorkbenchStateResponse200Type0 | GetApiExperimentsBySlugWorkbenchStateResponse200Type1 | GetApiExperimentsBySlugWorkbenchStateResponse400 | GetApiExperimentsBySlugWorkbenchStateResponse401 | GetApiExperimentsBySlugWorkbenchStateResponse404
    """

    return (
        await asyncio_detailed(
            slug=slug,
            client=client,
            fields=fields,
        )
    ).parsed
