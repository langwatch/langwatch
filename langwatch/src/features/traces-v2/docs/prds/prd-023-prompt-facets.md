# PRD-023 — Prompt Facets

Status: Draft
Owner: traces-v2
Spec: `specs/traces-v2/prompt-facets.feature`

## Problem

Today the only way to filter traces by prompt is via the legacy `prompt:`
field (sidebar-hidden), which scans `metadata.prompt_ids` (an unordered
array of handles touched in the trace). The richer span attributes —
`langwatch.prompt.selected.id`, `langwatch.prompt.id`,
`langwatch.prompt.version.number`, `langwatch.prompt.version.id` — are not
projected onto the trace summary at all. Users have to dig through raw
attributes or write metadata-key queries by hand to answer "which trace
ran prompt X version 5?" or "which prompt did the developer pin?".

## Goal

Promote prompt identity to first-class trace-level facets in the v2
sidebar and search syntax. Three sections under a new "Prompts" group:

1. **Selected prompt** — categorical, projected from
   `langwatch.prompt.selected.id` on the latest span carrying it.
2. **Last used prompt** — categorical, projected from `langwatch.prompt.id`
   (or `langwatch.prompt.handle`) on the latest span carrying it.
3. **Prompt version** — range, the `langwatch.prompt.version.number` from
   the same span as Last used prompt.

Each rolled-up value also stores the **SpanId of the source span**, so the
drawer can open straight to that span when a user clicks a facet hit.

"Latest span" = greatest `StartedAt` among the spans in that trace that
carry the attribute (ties broken by SpanId for determinism).

## Non-goals

- Not building a per-span filter; this is a trace-level rollup. Per-span
  prompt querying stays in the trace drawer.
- Legacy `prompt:` field stays as-is, still keyed off
  `metadata.prompt_ids`. Removing it is a follow-up.

## Data shape — new columns on `trace_summaries`

```sql
ContainsPrompt                 Bool DEFAULT 0

SelectedPromptId               Nullable(String)  CODEC(ZSTD(1))
SelectedPromptSpanId           Nullable(String)  CODEC(ZSTD(1))

LastUsedPromptId               Nullable(String)  CODEC(ZSTD(1))
LastUsedPromptVersionNumber    Nullable(UInt32)
LastUsedPromptVersionId        Nullable(String)  CODEC(ZSTD(1))
LastUsedPromptSpanId           Nullable(String)  CODEC(ZSTD(1))
```

`ContainsPrompt` mirrors the existing `ContainsAi` Bool from migration
`00019` — a cheap "this trace touched a managed prompt at all" gate
that lets the sidebar pre-filter the dataset before the specific
prompt-id facets get involved. Computed at ingest as
`SelectedPromptId IS NOT NULL OR LastUsedPromptId IS NOT NULL`.

Indexes:

```sql
INDEX idx_contains_prompt   ContainsPrompt              TYPE set(2)             GRANULARITY 4
INDEX idx_selected_prompt   SelectedPromptId            TYPE bloom_filter(0.01) GRANULARITY 4
INDEX idx_last_used_prompt  LastUsedPromptId            TYPE bloom_filter(0.01) GRANULARITY 4
INDEX idx_prompt_version    LastUsedPromptVersionNumber TYPE minmax             GRANULARITY 4
```

`LastUsedPromptId` stores the handle (slug part before `:` in the combined
`prompt.id` form, or raw `langwatch.prompt.handle` in the separate form).
The version is its own column so range queries (`promptVersion:>=3`,
`promptVersion:[3 TO 7]`) execute directly without parsing.

`*SpanId` columns are not indexed — they're only ever read after a row
already matches on the prompt-id columns, so the bloom filter on the id
columns carries the work and the SpanId comes along for free.

## Implementation outline

1. **Spec + PRD** — this doc + `prompt-facets.feature`.
2. **Migration** — `00020_add_trace_summary_prompt_columns.sql`. Seven
   `ADD COLUMN IF NOT EXISTS` statements (six prompt + `ContainsPrompt`)
   plus four `ADD INDEX` statements, each in its own
   `+goose StatementBegin`/`StatementEnd` block (multi-statement queries
   not supported on CH — see `CLAUDE.md`). Down migration commented out.
3. **Trace summary mapper**
   (`src/server/traces/mappers/trace-summary.mapper.ts`): walk the
   trace's spans sorted by `StartedAt` desc, pick the first match per
   source attribute, write the six fields. Reuse `parsePromptReference`
   for the combined `prompt.id` form.
4. **Backfill** — one-shot job that re-walks recent partitions and
   populates the new columns from `stored_spans`. Old traces stay null
   until they're re-ingested or the backfill runs against them.
5. **ClickHouse trace service** — add the six columns to the SELECT
   list and the row → `TraceSummary` mapping.
6. **Search registry** — extend `SEARCH_FIELDS` in
   `langwatch/src/features/traces-v2/utils/queryParser.ts`:
   ```ts
   selectedPrompt: { label: "Selected prompt", hasSidebar: true,
                     facetField: "selectedPrompt", valueType: "categorical" },
   lastUsedPrompt: { label: "Last used prompt", hasSidebar: true,
                     facetField: "lastUsedPrompt", valueType: "categorical" },
   promptVersion:  { label: "Prompt version",  hasSidebar: true,
                     facetField: "promptVersion",  valueType: "range" },
   ```
7. **Backend filter handler** — register three filter conditions in
   `langwatch/src/server/filters/clickhouse/filter-conditions.ts`
   mapping each field key to its new column.
8. **Facet aggregator** — extend the facet-values tRPC procedure to
   return `topValues` for the two id columns and a numeric distribution
   for the version column.
9. **Sidebar** — add a `prompts` `FacetGroupDef` to `FACET_GROUPS` in
   `FilterSidebar/constants.ts`, between `trace` and `metrics`. Icons:
   `Sparkles` (selected), `Clock` (last-used), `Hash` (version).
10. **Drawer deep-link** — wire facet-hit click → open trace drawer,
    pre-select the span at `SelectedPromptSpanId` /
    `LastUsedPromptSpanId` (whichever facet was clicked).
11. **Autocomplete** — wire `useDynamicValueSuggestions` to return
    project-scoped prompt handles for the two categorical fields.

## Tradeoffs

- **Schema vs query-time projection.** Adding columns means a migration
  and a backfill, but every list query benefits long-term — these are
  hot, partition-pruned queries served thousands of times a day. Doing
  it from the Map-attributes column (the previous draft of this PRD)
  would have dodged the migration, but the user's call: while we're
  here, do it properly.
- **One column per concept vs `Map(String, String)`.** Discrete columns
  are simpler to filter and index, and avoid `mapContains`/`JSONExtract`
  overhead at facet-aggregation time. The cost is a handful of mostly
  null columns on traces without prompts; ZSTD + Nullable handles that
  cheaply.
- **"Latest span" definition.** Using `StartedAt` (not `EndedAt`) keeps
  long-running parents from masking later child spans. Ties on
  `StartedAt` resolve by SpanId so two ingests of the same trace
  produce the same rollup.

## Open questions

- Should `selectedPrompt` fall back to `lastUsedPrompt` when no span
  carries the explicit selection? Current take: **no** — the whole point
  is to distinguish "what the developer pinned" from "what actually
  ran". Empty state stays honest.
- Do we want a `Prompt tag` facet too (`langwatch.prompt.tag` —
  `production`/`staging`)? Out of scope for this PRD; trivial follow-up
  on the same column-per-concept pattern.
