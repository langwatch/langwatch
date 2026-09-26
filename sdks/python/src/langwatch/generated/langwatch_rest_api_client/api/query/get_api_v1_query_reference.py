from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_query_reference_response_200 import GetApiV1QueryReferenceResponse200
from ...models.get_api_v1_query_reference_response_400 import GetApiV1QueryReferenceResponse400
from ...models.get_api_v1_query_reference_response_401 import GetApiV1QueryReferenceResponse401
from ...models.get_api_v1_query_reference_response_403 import GetApiV1QueryReferenceResponse403
from ...models.get_api_v1_query_reference_response_500 import GetApiV1QueryReferenceResponse500
from ...types import Response, safe_http_status


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/query/reference",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiV1QueryReferenceResponse200
    | GetApiV1QueryReferenceResponse400
    | GetApiV1QueryReferenceResponse401
    | GetApiV1QueryReferenceResponse403
    | GetApiV1QueryReferenceResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetApiV1QueryReferenceResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetApiV1QueryReferenceResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = GetApiV1QueryReferenceResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = GetApiV1QueryReferenceResponse403.from_dict(response.json())

        return response_403

    if response.status_code == 500:
        response_500 = GetApiV1QueryReferenceResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiV1QueryReferenceResponse200
    | GetApiV1QueryReferenceResponse400
    | GetApiV1QueryReferenceResponse401
    | GetApiV1QueryReferenceResponse403
    | GetApiV1QueryReferenceResponse500
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
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiV1QueryReferenceResponse200
    | GetApiV1QueryReferenceResponse400
    | GetApiV1QueryReferenceResponse401
    | GetApiV1QueryReferenceResponse403
    | GetApiV1QueryReferenceResponse500
]:
    """Discover both query languages

     Describes both query languages in one payload: LangWatchQL (SQL over the analytics views) with its
    schema, limits and endpoints, and the trace filter (a Lucene-flavored string over the trace list)
    with its syntax, its fields and their static value vocabularies, and the open-ended attribute
    namespaces.

    It also carries worked examples in both languages and a table saying which language answers which
    kind of question. Every example is checked against the real validator and the real translator before
    it ships, so a published example parses and compiles; whether THIS key can run one is its own
    `available` flag.

    Pure: it reads the catalogs and this key's own permissions, never the project's traces, so it
    answers from memory rather than from the database.

    It answers `Cache-Control: private, no-store`, because the document is shaped by the calling
    credential: `available`, the embedded schema and the gated columns all differ between keys, and a
    cache keyed on the URL or the project would replay one key's document to another. Ask for it again
    rather than storing it.

    The values a field actually holds change under you and are a separate call — `GET
    /api/traces/facets`.

    An example this key cannot run is listed with `available: false` and keeps its `requires.gates`, so
    a caller can see which permission it needs.

    Any credential for the project may read it. The trace filter half is the traces family's vocabulary,
    so a key scoped to `traces:view` alone is answered rather than refused; for that key the LangWatchQL
    half arrives with `lwql.enabled: false` and an empty schema. `GET /api/v1/query/schema` is stricter
    and refuses that key outright, which is why this document withholds the catalog rather than
    repeating it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1QueryReferenceResponse200 | GetApiV1QueryReferenceResponse400 | GetApiV1QueryReferenceResponse401 | GetApiV1QueryReferenceResponse403 | GetApiV1QueryReferenceResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1QueryReferenceResponse200
    | GetApiV1QueryReferenceResponse400
    | GetApiV1QueryReferenceResponse401
    | GetApiV1QueryReferenceResponse403
    | GetApiV1QueryReferenceResponse500
    | None
):
    """Discover both query languages

     Describes both query languages in one payload: LangWatchQL (SQL over the analytics views) with its
    schema, limits and endpoints, and the trace filter (a Lucene-flavored string over the trace list)
    with its syntax, its fields and their static value vocabularies, and the open-ended attribute
    namespaces.

    It also carries worked examples in both languages and a table saying which language answers which
    kind of question. Every example is checked against the real validator and the real translator before
    it ships, so a published example parses and compiles; whether THIS key can run one is its own
    `available` flag.

    Pure: it reads the catalogs and this key's own permissions, never the project's traces, so it
    answers from memory rather than from the database.

    It answers `Cache-Control: private, no-store`, because the document is shaped by the calling
    credential: `available`, the embedded schema and the gated columns all differ between keys, and a
    cache keyed on the URL or the project would replay one key's document to another. Ask for it again
    rather than storing it.

    The values a field actually holds change under you and are a separate call — `GET
    /api/traces/facets`.

    An example this key cannot run is listed with `available: false` and keeps its `requires.gates`, so
    a caller can see which permission it needs.

    Any credential for the project may read it. The trace filter half is the traces family's vocabulary,
    so a key scoped to `traces:view` alone is answered rather than refused; for that key the LangWatchQL
    half arrives with `lwql.enabled: false` and an empty schema. `GET /api/v1/query/schema` is stricter
    and refuses that key outright, which is why this document withholds the catalog rather than
    repeating it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1QueryReferenceResponse200 | GetApiV1QueryReferenceResponse400 | GetApiV1QueryReferenceResponse401 | GetApiV1QueryReferenceResponse403 | GetApiV1QueryReferenceResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetApiV1QueryReferenceResponse200
    | GetApiV1QueryReferenceResponse400
    | GetApiV1QueryReferenceResponse401
    | GetApiV1QueryReferenceResponse403
    | GetApiV1QueryReferenceResponse500
]:
    """Discover both query languages

     Describes both query languages in one payload: LangWatchQL (SQL over the analytics views) with its
    schema, limits and endpoints, and the trace filter (a Lucene-flavored string over the trace list)
    with its syntax, its fields and their static value vocabularies, and the open-ended attribute
    namespaces.

    It also carries worked examples in both languages and a table saying which language answers which
    kind of question. Every example is checked against the real validator and the real translator before
    it ships, so a published example parses and compiles; whether THIS key can run one is its own
    `available` flag.

    Pure: it reads the catalogs and this key's own permissions, never the project's traces, so it
    answers from memory rather than from the database.

    It answers `Cache-Control: private, no-store`, because the document is shaped by the calling
    credential: `available`, the embedded schema and the gated columns all differ between keys, and a
    cache keyed on the URL or the project would replay one key's document to another. Ask for it again
    rather than storing it.

    The values a field actually holds change under you and are a separate call — `GET
    /api/traces/facets`.

    An example this key cannot run is listed with `available: false` and keeps its `requires.gates`, so
    a caller can see which permission it needs.

    Any credential for the project may read it. The trace filter half is the traces family's vocabulary,
    so a key scoped to `traces:view` alone is answered rather than refused; for that key the LangWatchQL
    half arrives with `lwql.enabled: false` and an empty schema. `GET /api/v1/query/schema` is stricter
    and refuses that key outright, which is why this document withholds the catalog rather than
    repeating it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1QueryReferenceResponse200 | GetApiV1QueryReferenceResponse400 | GetApiV1QueryReferenceResponse401 | GetApiV1QueryReferenceResponse403 | GetApiV1QueryReferenceResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetApiV1QueryReferenceResponse200
    | GetApiV1QueryReferenceResponse400
    | GetApiV1QueryReferenceResponse401
    | GetApiV1QueryReferenceResponse403
    | GetApiV1QueryReferenceResponse500
    | None
):
    """Discover both query languages

     Describes both query languages in one payload: LangWatchQL (SQL over the analytics views) with its
    schema, limits and endpoints, and the trace filter (a Lucene-flavored string over the trace list)
    with its syntax, its fields and their static value vocabularies, and the open-ended attribute
    namespaces.

    It also carries worked examples in both languages and a table saying which language answers which
    kind of question. Every example is checked against the real validator and the real translator before
    it ships, so a published example parses and compiles; whether THIS key can run one is its own
    `available` flag.

    Pure: it reads the catalogs and this key's own permissions, never the project's traces, so it
    answers from memory rather than from the database.

    It answers `Cache-Control: private, no-store`, because the document is shaped by the calling
    credential: `available`, the embedded schema and the gated columns all differ between keys, and a
    cache keyed on the URL or the project would replay one key's document to another. Ask for it again
    rather than storing it.

    The values a field actually holds change under you and are a separate call — `GET
    /api/traces/facets`.

    An example this key cannot run is listed with `available: false` and keeps its `requires.gates`, so
    a caller can see which permission it needs.

    Any credential for the project may read it. The trace filter half is the traces family's vocabulary,
    so a key scoped to `traces:view` alone is answered rather than refused; for that key the LangWatchQL
    half arrives with `lwql.enabled: false` and an empty schema. `GET /api/v1/query/schema` is stricter
    and refuses that key outright, which is why this document withholds the catalog rather than
    repeating it.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1QueryReferenceResponse200 | GetApiV1QueryReferenceResponse400 | GetApiV1QueryReferenceResponse401 | GetApiV1QueryReferenceResponse403 | GetApiV1QueryReferenceResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
