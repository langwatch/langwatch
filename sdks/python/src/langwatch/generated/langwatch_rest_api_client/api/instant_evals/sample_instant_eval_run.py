from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.sample_instant_eval_run_response_200 import SampleInstantEvalRunResponse200
from ...types import UNSET, Response, Unset, safe_http_status


def _get_kwargs(
    id: str,
    *,
    n: int | Unset = 5,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["n"] = n

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/instant-evals/{id}/sample".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> SampleInstantEvalRunResponse200 | None:
    if response.status_code == 200:
        response_200 = SampleInstantEvalRunResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[SampleInstantEvalRunResponse200]:
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
    id: str,
    *,
    client: AuthenticatedClient,
    n: int | Unset = 5,
) -> Response[SampleInstantEvalRunResponse200]:
    """Sample a run

     Read a few of the run's rows with the text that was judged beside the verdict it received. The text
    is re-read through the statement's own extraction functions, so nothing is judged again and reading
    a sample is free.

    Args:
        id (str):
        n (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[SampleInstantEvalRunResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        n=n,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    n: int | Unset = 5,
) -> SampleInstantEvalRunResponse200 | None:
    """Sample a run

     Read a few of the run's rows with the text that was judged beside the verdict it received. The text
    is re-read through the statement's own extraction functions, so nothing is judged again and reading
    a sample is free.

    Args:
        id (str):
        n (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        SampleInstantEvalRunResponse200
    """

    return sync_detailed(
        id=id,
        client=client,
        n=n,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    n: int | Unset = 5,
) -> Response[SampleInstantEvalRunResponse200]:
    """Sample a run

     Read a few of the run's rows with the text that was judged beside the verdict it received. The text
    is re-read through the statement's own extraction functions, so nothing is judged again and reading
    a sample is free.

    Args:
        id (str):
        n (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[SampleInstantEvalRunResponse200]
    """

    kwargs = _get_kwargs(
        id=id,
        n=n,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    n: int | Unset = 5,
) -> SampleInstantEvalRunResponse200 | None:
    """Sample a run

     Read a few of the run's rows with the text that was judged beside the verdict it received. The text
    is re-read through the statement's own extraction functions, so nothing is judged again and reading
    a sample is free.

    Args:
        id (str):
        n (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        SampleInstantEvalRunResponse200
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            n=n,
        )
    ).parsed
