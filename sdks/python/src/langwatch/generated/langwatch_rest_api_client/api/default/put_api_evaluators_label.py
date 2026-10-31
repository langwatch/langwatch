from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_api_evaluators_label_body import PutApiEvaluatorsLabelBody
from ...models.put_api_evaluators_label_response_200 import PutApiEvaluatorsLabelResponse200
from ...models.put_api_evaluators_label_response_400 import PutApiEvaluatorsLabelResponse400
from ...models.put_api_evaluators_label_response_404 import PutApiEvaluatorsLabelResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    evaluator_id: str,
    label: str,
    *,
    body: PutApiEvaluatorsLabelBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/evaluators/{evaluator_id}/labels/{label}".format(
            evaluator_id=quote(str(evaluator_id), safe=""),
            label=quote(str(label), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404 | None:
    if response.status_code == 200:
        response_200 = PutApiEvaluatorsLabelResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PutApiEvaluatorsLabelResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = PutApiEvaluatorsLabelResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404]:
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
    evaluator_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: PutApiEvaluatorsLabelBody,
) -> Response[PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404]:
    """Point a deploy label, such as production, at one of the evaluator's versions

    Args:
        evaluator_id (str):
        label (str):
        body (PutApiEvaluatorsLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404]
    """

    kwargs = _get_kwargs(
        evaluator_id=evaluator_id,
        label=label,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    evaluator_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: PutApiEvaluatorsLabelBody,
) -> PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404 | None:
    """Point a deploy label, such as production, at one of the evaluator's versions

    Args:
        evaluator_id (str):
        label (str):
        body (PutApiEvaluatorsLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404
    """

    return sync_detailed(
        evaluator_id=evaluator_id,
        label=label,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    evaluator_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: PutApiEvaluatorsLabelBody,
) -> Response[PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404]:
    """Point a deploy label, such as production, at one of the evaluator's versions

    Args:
        evaluator_id (str):
        label (str):
        body (PutApiEvaluatorsLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404]
    """

    kwargs = _get_kwargs(
        evaluator_id=evaluator_id,
        label=label,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    evaluator_id: str,
    label: str,
    *,
    client: AuthenticatedClient,
    body: PutApiEvaluatorsLabelBody,
) -> PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404 | None:
    """Point a deploy label, such as production, at one of the evaluator's versions

    Args:
        evaluator_id (str):
        label (str):
        body (PutApiEvaluatorsLabelBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutApiEvaluatorsLabelResponse200 | PutApiEvaluatorsLabelResponse400 | PutApiEvaluatorsLabelResponse404
    """

    return (
        await asyncio_detailed(
            evaluator_id=evaluator_id,
            label=label,
            client=client,
            body=body,
        )
    ).parsed
