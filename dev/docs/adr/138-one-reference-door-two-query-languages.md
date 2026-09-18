# ADR-138: One reference door, two query languages

**Date:** 2026-09-18

**Status:** Accepted

## Context

LangWatch answers two query languages, and they are not alternatives.

LangWatchQL is SQL over the analytics datasets (ADR-081 to ADR-085, ADR-101).
It answers counts, rates, groupings, time series and joins, over
`analytics.traces`, `analytics.spans`, `analytics.trace_metrics` and the
per-minute rollups. It returns columns.

The trace filter is a Lucene-flavored string (liqe) over one trace list. It has
about fifty named fields plus three open-ended attribute namespaces, reaches
span events and evaluator verdicts, and returns whole traces with their spans.
It already persists as a durable artifact: `Trigger.filterQuery` stores one
(ADR-043), and so does a saved view.

A question belongs to one or the other, and picking wrong is expensive. An agent
that only knows the filter writes twelve searches where one `GROUP BY` would do.
An agent that only knows the SQL cannot find a trace by an attribute key at all.

Both languages published their pieces, in different places and to different
readers:

- the LangWatchQL schema to an API caller, at `GET /api/v1/query/schema`;
- `SEARCH_FIELDS` to the browser, through tRPC;
- `QUERY_SYNTAX_DOC` to the Trace Explorer's AI-mode prompt, and nowhere else;
- the filter's own value lists to nobody outside tRPC.

What that produced is measurable. The MCP server carried a hand-copied list of
24 filter field names in `schemas/filter-fields.ts`: it named fields the platform
had renamed and missed the ones the Trace Explorer had gained, and nothing could
notice, because there was no original to compare the copy against.
`QUERY_SYNTAX_DOC` documented `attribute.<key>` while the autocomplete, the saved
views and the translator had moved to `trace.attribute.<key>` — and the span
namespace, which has no older spelling at all, was undiscoverable. The
`fieldCatalogue.ts` docblock records that a CLI query reference was the reason it
was extracted, and that it had not been built.

## Decision

**One reference door describes both languages: `GET /api/v1/query/reference`.**

It is a sibling of `/schema`, which stays byte-compatible and keeps its
consumers. The reference embeds that same schema and adds the trace filter half,
so a caller that wants both pays one round trip.

It is built by `server/analytics/query-reference/describeQueryReference`, which
is **pure**: it reads the LangWatchQL catalog, the filter field registry, the two
example libraries and the caller's `Protections`, and touches no tenant data and
no database. That is what lets the endpoint answer from memory, and what lets the
MCP server's committed fixture be generated from it.

**Four rules follow from wanting one door rather than two descriptions.**

*Every published query is checked by machine, not by reading.* The two example
libraries (`server/analytics/lwql/examples` and
`app-layer/traces/query-language/examples.ts`) are pinned by a test: each
LangWatchQL statement goes through the real validator against the real catalog,
and each filter string through the real parser, the real semantic check and the
real ClickHouse compiler. A published example the API would refuse on sight is
worse than no example, because it costs its reader a round trip to find that
out.

That is a build-time check and it is not the same claim as "this runs for you".
A statement can pass the validator and still be unavailable to a caller, which
is what `available` on each example says: the column gates this key does not
hold, or a project with no LangWatchQL surface at all. Unavailable examples stay
published, with their requirements intact, because the requirement is the useful
part of the answer.

*Live values are not in the reference.* The values a field actually holds are
tenant data, they move under the caller, and reading them all costs about thirty
aggregate queries. They live at `GET /api/traces/facets` and the reference names
that endpoint instead of inlining a snapshot of it. That is also what keeps the
reference cacheable.

*An unavailable example stays published.* An example whose columns need a
permission the caller lacks is published with `available: false` and its
`requires.gates` intact — the same rule `/schema` applies to a withheld column,
for the same reason: hiding it would hide the one fact that makes the refusal
actionable.

*Every consumer reads the door, never a copy of it.* The MCP server's
`discover_schema` fetches it (so `schemas/filter-fields.ts` is deleted, and its
categories now need the API key), the CLI's `query reference`, `query examples`
and `trace fields` fetch it, and the MCP fixture is generated from the builder by
`pnpm generate:query-reference-fixture` and pinned by a platform test.

**The languages also reach the API-key surface, where only one of them did.**
`POST /api/traces/search` gains `filter`, AND-combined with `filters`, `query`
and `traceIds`. The boundary compiles the string and hands the datastore layer a
parameterized condition rather than the string itself: a parse failure has to
become a 422 naming the field, and a rejection raised behind a datastore call can
only surface as a 500. `GET /api/traces/facets` answers the value question, with
two shapes from one path — the whole discovery payload without `field`, one
field's values with it.

**`GET /api/traces/facets` takes no `filter`.** The facet compute spans three
tables (`trace_summaries`, `stored_spans`, `evaluation_runs`) and the filter
translates only against `trace_summaries ts`, so a filter could be honored on
some facets and silently ignored on others. Value discovery is over the whole
window, and the reference says so.

## Rationale / Trade-offs

The alternative was a per-language door: a filter-fields endpoint beside the
schema endpoint. It is a smaller change and it answers the drift problem, but it
does not answer the routing problem, which is the expensive one. An agent with
two endpoints and no decision table still picks wrong; the `decisionTable` is the
part of this document that only exists because both languages are described in
one place.

Making the reference pure costs it the live values, which are what an agent most
often actually needs. That is paid for by the facets endpoint being a separate,
cheap call: the reference is cacheable and the values are fresh, where one
endpoint doing both would have been neither.

Making `discover_schema`'s filter and SQL categories need the API key is a real
regression in what an unconfigured MCP server can answer. It is accepted because
the alternative is the drifted copy, and because every other tool in that server
already needs the key.

## Consequences

`server/analytics/query-reference` is now the one place a query language is
described to an agent. A field added to `SEARCH_FIELDS` appears in the REST
reference, the CLI and the MCP server with no further edit, and a drift test
fails when an example stops working.

The MCP server's `discover_schema` gains an `lwql` category and loses its ability
to answer `filters`, `lwql` or `all` without a credential.

`langwatch query` is the first CLI door to LangWatchQL that does not go through a
saved chart. `--format jsonl` and `--page-by keyset` make it the export path for
the post-training case: the query endpoint has no cursor, so paging is a
predicate the author wrote over parameters the author declared, and the statement
text is identical on every page.

`QUERY_SYNTAX_DOC` now documents the canonical attribute prefixes, with the older
spellings listed as accepted. A drift test asserts it names every prefix
`DYNAMIC_PREFIXES` publishes, so the two cannot separate again.

Open, deliberately: the reference publishes `requires.functions` on every example
and it is always empty. The LangWatchQL app-function catalog ships separately, and
an example naming one would be an example the validator refuses. The field is
there so a consumer parses one shape before and after that lands.

## References

- Related ADRs: ADR-081 to ADR-085 and ADR-101 (LangWatchQL), ADR-043
  (`Trigger.filterQuery` persists a filter string), ADR-045 (handled errors at a
  boundary)
- Specs: `specs/analytics/query-reference.feature`,
  `specs/traces/trace-filter-api.feature`,
  `specs/analytics/lwql-cli-query.feature`,
  `specs/mcp-server/schema-discovery.feature`
