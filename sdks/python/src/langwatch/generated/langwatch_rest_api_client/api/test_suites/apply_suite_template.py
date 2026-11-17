from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.apply_suite_template_body import ApplySuiteTemplateBody
from ...models.apply_suite_template_response_201 import ApplySuiteTemplateResponse201
from ...models.apply_suite_template_response_404 import ApplySuiteTemplateResponse404
from ...types import Response, safe_http_status


def _get_kwargs(
    template_id: str,
    *,
    body: ApplySuiteTemplateBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/test-suites/templates/{template_id}/apply".format(
            template_id=quote(str(template_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404 | None:
    if response.status_code == 201:
        response_201 = ApplySuiteTemplateResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 404:
        response_404 = ApplySuiteTemplateResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404]:
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
    template_id: str,
    *,
    client: AuthenticatedClient,
    body: ApplySuiteTemplateBody,
) -> Response[ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404]:
    """Apply a suite template

     Create a test suite from a template, with one scenario per template scenario filled from the fit:
    the agent's name, its tools and what it must never do. The suite name defaults to the template
    title. An unknown template id answers 404 suite_template_not_found.

    Args:
        template_id (str):
        body (ApplySuiteTemplateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404]
    """

    kwargs = _get_kwargs(
        template_id=template_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    template_id: str,
    *,
    client: AuthenticatedClient,
    body: ApplySuiteTemplateBody,
) -> ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404 | None:
    """Apply a suite template

     Create a test suite from a template, with one scenario per template scenario filled from the fit:
    the agent's name, its tools and what it must never do. The suite name defaults to the template
    title. An unknown template id answers 404 suite_template_not_found.

    Args:
        template_id (str):
        body (ApplySuiteTemplateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404
    """

    return sync_detailed(
        template_id=template_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    template_id: str,
    *,
    client: AuthenticatedClient,
    body: ApplySuiteTemplateBody,
) -> Response[ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404]:
    """Apply a suite template

     Create a test suite from a template, with one scenario per template scenario filled from the fit:
    the agent's name, its tools and what it must never do. The suite name defaults to the template
    title. An unknown template id answers 404 suite_template_not_found.

    Args:
        template_id (str):
        body (ApplySuiteTemplateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404]
    """

    kwargs = _get_kwargs(
        template_id=template_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    template_id: str,
    *,
    client: AuthenticatedClient,
    body: ApplySuiteTemplateBody,
) -> ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404 | None:
    """Apply a suite template

     Create a test suite from a template, with one scenario per template scenario filled from the fit:
    the agent's name, its tools and what it must never do. The suite name defaults to the template
    title. An unknown template id answers 404 suite_template_not_found.

    Args:
        template_id (str):
        body (ApplySuiteTemplateBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApplySuiteTemplateResponse201 | ApplySuiteTemplateResponse404
    """

    return (
        await asyncio_detailed(
            template_id=template_id,
            client=client,
            body=body,
        )
    ).parsed
