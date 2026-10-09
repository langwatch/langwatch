from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.cancel_instant_eval_run_response_200 import CancelInstantEvalRunResponse200
from ...models.cancel_instant_eval_run_response_404 import CancelInstantEvalRunResponse404
from ...models.cancel_instant_eval_run_response_409 import CancelInstantEvalRunResponse409
from ...types import Response, safe_http_status


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/instant-evals/{id}/cancel".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409 | None:
    if response.status_code == 200:
        response_200 = CancelInstantEvalRunResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = CancelInstantEvalRunResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = CancelInstantEvalRunResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409]:
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
) -> Response[CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409]:
    """Cancel a run

     Ask a run to stop. The run stops before its next page, so the pages it already judged keep their
    judgements and are still readable. A run that has already finished, failed or been cancelled answers
    409 instant_eval_already_finished.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
) -> CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409 | None:
    """Cancel a run

     Ask a run to stop. The run stops before its next page, so the pages it already judged keep their
    judgements and are still readable. A run that has already finished, failed or been cancelled answers
    409 instant_eval_already_finished.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409]:
    """Cancel a run

     Ask a run to stop. The run stops before its next page, so the pages it already judged keep their
    judgements and are still readable. A run that has already finished, failed or been cancelled answers
    409 instant_eval_already_finished.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409 | None:
    """Cancel a run

     Ask a run to stop. The run stops before its next page, so the pages it already judged keep their
    judgements and are still readable. A run that has already finished, failed or been cancelled answers
    409 instant_eval_already_finished.

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CancelInstantEvalRunResponse200 | CancelInstantEvalRunResponse404 | CancelInstantEvalRunResponse409
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
