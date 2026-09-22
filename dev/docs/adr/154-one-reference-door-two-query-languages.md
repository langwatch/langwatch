# ADR-154: One reference door, two query languages

**Date:** 2026-09-18

**Status:** Accepted

Recorded upstream as ADR-138; 138 is `persistence-containment` on this branch,
so the record lands at 154 and every cross-reference below uses this tree's
numbers.

## Context

LangWatch answers two query languages, and they are not alternatives.

LangWatchQL is SQL over the analytics datasets. It answers counts, rates,
groupings, time series and joins, over `analytics.traces`, `analytics.spans`,
`analytics.trace_metrics` and the per-minute rollups. It returns columns.

The trace filter is a Lucene-flavoured string (liqe) over one trace list. It has
about fifty named fields plus three open-ended attribute namespaces, reaches
span events and evaluator verdicts, and returns whole traces with their spans.
It already persists as a durable artifact: a trigger's filter query stores one,
and so does a saved view.

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
filter field names: it named fields the platform had renamed and missed the ones
the Trace Explorer had gained, and nothing could notice, because there was no
original to compare the copy against. `QUERY_SYNTAX_DOC` documents
`attribute.<key>` while the autocomplete, the saved views and the translator had
moved to `trace.attribute.<key>` — and the span namespace, which has no older
spelling at all, was undiscoverable.

## Decision

**One reference door describes both languages: `GET /api/v1/query/reference`.**

It is a sibling of `/schema`, which stays byte-compatible and keeps its
consumers. The reference embeds that same schema and adds the trace filter half,
so a caller that wants both pays one round trip.

It is built by `buildQueryReference` in
`modules/analytics/process/src/rules/query-reference.rules.ts`, which is
**pure**: it reads the LangWatchQL catalogue, the filter field registry, the
example libraries and the caller's protections, and touches no tenant data and
no database. That is what lets the endpoint answer from memory, and what lets
the MCP server's committed fixture be generated from it.

The door names no permission of its own. Half of what it describes is the traces
family's vocabulary, so a key without `analytics:view` is answered with the
LangWatchQL half withheld — `enabled: false` and an empty catalogue — rather
than refused, while `/schema` stays strict and refuses that key outright.

**Four rules follow from wanting one door rather than two descriptions.**

*Every published query is checked by machine, not by reading.* Each LangWatchQL
statement goes through the real validator against the real catalogue, and each
filter string through the real parser and compiler. A published example the API
would refuse on sight is worse than no example, because it costs its reader a
round trip to find that out.

That is a build-time check and it is not the same claim as "this runs for you".
A statement can pass the validator and still be unavailable to a caller, which
is what `available` on each example says.

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

*Every consumer reads the door, never a copy of it.* The MCP server's schema
discovery fetches it, the CLI's `query reference` and `query examples` fetch it,
and the MCP fixture is generated from the builder rather than hand-written.

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

The trace filter half is read from `@langwatch/trace-contract` — the module that
owns the language publishes its own vocabulary, and analytics assembles the
document. Analytics never reaches into trace's services for it.

## Consequences

The reference is now the one place a query language is described to an agent. A
field added to `SEARCH_FIELDS` appears in it with no further edit, and a drift
test fails when a published example stops validating.

Not yet true on this branch, and each one is a named gap rather than a silent
one:

- the filter language's worked examples are trace's to publish, and
  `TRACE_FILTER_EXAMPLES` has not landed in `@langwatch/trace-contract`. The
  document therefore carries the SQL half's examples alone.
- `QUERY_SYNTAX_DOC` still documents only the older attribute spellings, so the
  scenario that pins the canonical prefixes stays unbound.
- `langwatch query reference` and `query examples` wait on the frozen OpenAPI
  document: the generated client has no `/api/v1/query/reference` path until it
  is regenerated from the running API.

Open, deliberately: the reference publishes `requires.functions` on every example
and it is always empty. An example naming an app function would be an example the
validator refuses, so the field is there for a consumer to parse one shape before
and after that lands.

## References

- Related ADRs: ADR-136 (LangWatchQL app functions), ADR-045 (handled errors at a
  boundary)
- Specs: `specs/analytics/query-reference.feature`,
  `specs/analytics/lwql-cli-query.feature`
