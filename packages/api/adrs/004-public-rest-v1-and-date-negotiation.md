# Public REST has a static v1 and an optional date version

**Date:** 2026-08-27

**Status:** Accepted, amended 2026-09-04 (`v1` is not public-REST-only)

**Behavioural contract:**
[../specs/public-rest.feature](../specs/public-rest.feature)

**Related:**
[the fluent handler contract](./001-rpc-first-fluent-registration.md),
[explicit RPC namespaces](./002-explicit-version-namespaces.md), and
[the API framework boundary](./20260820-api-framework-boundary.md), and
[public REST and internal tRPC ownership](../../../dev/docs/adr/128-public-rest-and-internal-trpc.md).

## Context

Public REST needs the same schema, versioning and middleware guarantees as RPC
without making authors describe HTTP parsing. Its stable product generation
and its date-based contract version are different things: changing a date
version must not imply a `v2`, while a future global break must remain visible.

## Decision

`createRestService` is an additive surface. No existing `createService`
consumer or URL changes until a family deliberately migrates.

An endpoint is declared through `.get`, `.post`, `.put`, `.patch` or `.delete`.
Its chain has one Zod 4 `withInput` object and one `withOutput` schema. Path
parameters are fields in that input object. GET reads remaining fields from
the query; POST, PUT, PATCH and DELETE read them from a JSON object body. The
framework merges path fields, validates the complete input once, calls
`(context, input)`, validates the output and serializes it. Authors never
declare params, query or body sources.

The URL has two independent version axes:

```text
/api/v1/{service}/{endpoint}
/api/v1/{service}/{YYYY-MM-DD|latest}/{endpoint}
```

`v1` is the static global API generation. **Amended 2026-09-04:** it is not
this surface's alone. Every REST family answers under `/api/v1`, whichever
builder declares it, and `/api/v1/{thing}` is the canonical published prefix
for the whole API ([002 section 1](./002-explicit-version-namespaces.md)). What
stays specific to `createRestService` is the rest of this decision — the
optional date segment, the header negotiation and the one-input contract.

The optional segment is the existing
date-version catalogue: dates inherit the latest registration on or before
them, `latest` selects the newest registrations, and withdrawals remain dated.
When the segment is absent, `X-API-Version` may carry a date or `latest`; with
neither, the request selects `latest`.

An explicit URL version and header may both be present only when equal. A
conflict is 400, an invalid header is 400, and a date before the service exists
is 404. No source silently wins.

OpenAPI publishes the optional-version path, every registered date and
`latest`. The optional path documents the header and owns the declared
operation id; explicit mounts receive deterministic suffixes. All mounts use
the same resolved endpoint pipeline, including auth, capabilities, error
mapping and response validation. Errors remain centrally derived from thrown
errors; endpoints do not register error catalogues.

## Consequences

- REST and RPC share one handler, schema, capability and error discipline.
- A caller can pin a date visibly in its URL or operationally in a header.
- Path fields cannot bypass the one input schema.
- Existing routes keep every address they had, and gain their `/api/v1` twin.

## Alternatives considered

Separate params/query/body schemas were rejected because they expose transport
plumbing and split one domain input across declarations.

Letting the header override the URL was rejected because copied URLs would not
identify the contract they execute.

Using date versions as the global API generation was rejected because additive
contract evolution and a global breaking generation have different lifecycles.
