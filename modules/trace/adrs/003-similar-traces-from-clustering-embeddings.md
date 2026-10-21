# ADR-003: Similar traces reuse the embeddings topic clustering already computes

**Date:** 2026-10-21

**Status:** Proposed

## Context

Trace search matches substrings only (`ILIKE` and `positionCaseInsensitive` over
`trace_summaries`, with ngram bloom skip indexes). A user looking at one trace has no way to ask
for the traces that mean the same thing in other words.

Topic clustering already embeds trace inputs. Its intent pages a project's traces from
`trace_summaries` (the last 49 days, up to 2000 per page), sends their inputs to langevals, and
langevals calls the project's embeddings model through litellm, one 1536-wide vector per trace
(`text-embedding-3-small`, padded or cut to 1536). The vectors are used for clustering and then
dropped. Batch mode re-embeds the window on every run; incremental mode embeds only traces no
topic holds yet.

Constraints: projections make no network calls; external work belongs in intents. Every
ClickHouse read is fenced to the route's proof (ADR-177). A row derived from a trace must expire
with the trace (ADR-022). We do not want a single new embedding call.

## Decision

1. **langevals hands back what it computed, when asked.** Both clustering endpoints take
   `return_trace_embeddings` (default false) and then answer `trace_embeddings`: one
   `{trace_id, embedding}` per embedded trace. The vector is scaled so its largest component is
   127 and sent as base64 of int8: 2 KiB a trace, against roughly 30 KiB as JSON numbers.
   Cosine distance ignores a vector's length, so the scale is not sent. On 10,000 clustered
   1536-wide vectors this keeps 98.5% of each trace's ten nearest neighbours, and moves no
   distance by more than 0.0015.

   langevals runs on Lambda in SaaS, where a buffered response stops at 6 MB. The request also
   carries `max_response_bytes` (the runner sends 5 MiB); langevals adds embeddings in page order
   while the whole response stays under it and reports `trace_embeddings_omitted`. A full
   2000-trace page is about 4 MiB of embeddings, so most pages fit whole. An older langevals
   ignores both fields and answers without embeddings; an older app never sets them. Either
   order of deploy works.

2. **The clustering intent hands them to trace.** The runner sets the flag, and after storing the
   page's topics calls `TraceApi.recordTraceEmbeddings` with the embeddings model and, for each
   trace, the `OccurredAt` the page read it at (`occurredAtMsByTraceId` on the page). The write
   is best effort: a failure is logged and the page completes, because failing the page would make
   the outbox retry it and pay for every embedding again. No event carries the vectors: a 2 KiB
   vector per trace in the event log would be retained for as long as traces are, for a value that
   the next clustering run reproduces.

3. **Trace owns `trace_embeddings`** (goose 00123). `ReplacingMergeTree(UpdatedAt)`,
   `ORDER BY (TenantId, EmbeddingsModel, TraceId)`, `PARTITION BY toYearWeek(OccurredAt)`,
   `Embedding Array(Int8)`, `index_granularity = 1024`. A re-embedded trace replaces its row.
   Vectors are only compared within one model, so the model leads the trace in the key.

4. **Retention is the trace's.** The table is in `RETENTION_TABLE_CATEGORY_MAP` as `traces`, its
   TTL counts `_retention_days` from the trace's `OccurredAt`, writes stamp the project's trace
   retention from data-retention, and retroactive retention changes rewrite it like
   `trace_summaries`. It moves to cold storage with the other trace tables
   (`CLICKHOUSE_COLD_STORAGE_TRACE_EMBEDDINGS_TTL_DAYS`, default 49). It is platform-derived, so
   it carries no `_size_bytes` and is not metered as customer storage.

5. **The query is exact, not approximate.** `traces.findSimilar` (`traces:view`) narrows the
   route's proof to the one project that holds the trace (`tenantId` for an aggregate's member,
   otherwise the project), reads the trace's latest vector in the last 49 days, and ranks the same
   project's other traces of the same model by `cosineDistance`, nearest first, up to 50
   (default 10). Reads go
   through `{{tenantScope:OccurredAt}}`, so the fence, not the statement, names the tenant. A trace
   clustering has not embedded answers `not_embedded`.

6. **No vector similarity index yet.** ClickHouse 25.8 (our dev image) and 25.10 (the test image)
   both have `cosineDistance`; the HNSW `vector_similarity` index is available there too, but it
   is approximate across the whole table and needs a post-filter for `TenantId`, which can return
   fewer than N rows. Our read is one tenant and one model, which the sorting key already narrows
   to that project's own granules. Measured with `clickhouse local` 26.8 on two threads, with
   200,000 random 1536-wide vectors over two projects and the two statements the repository
   sends: as `Array(Int8)` the table is 293 MiB, finding the source vector takes 6 ms and ranking
   a 100,000-trace project takes 0.12 s. As `Array(Float32)` the same data was 1.04 GiB and the
   ranking took 0.6 to 1.5 s. That is fast enough for an explicit click on one trace. Revisit
   when a project holds well over a million embedded traces in the window.

## Consequences

- No new embedding calls and no new model configuration. Similar traces exist only for projects
  with topic clustering on, and only for traces clustering has read (non-empty input, last 49
  days). Similarity is over the trace's input text, as clustering sees it.
- Storage grows by about 1.5 KiB per clustered trace, kept for the trace's retention.
- A page whose embeddings do not fit under the response ceiling keeps the newest traces'
  embeddings and logs how many it left out.
- A project that changes its embeddings model has two populations of vectors until the older
  ones expire; each trace is compared only with its own model's.
- Left for follow-ups: the "Similar traces" entry point on the trace view, a public REST and MCP
  surface, and ranking by output or by a whole conversation.

## References

- ADR-022 data retention, ADR-024 cold storage, ADR-177 aggregate reads through grants
- Spec: `modules/trace/specs/similar-traces.feature`
