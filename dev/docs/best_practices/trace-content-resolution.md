# Trace Content Resolution

Trace input/output can be too large to store cheaply on every read path. ADR-022
caps IO attribute values (`langwatch.input`/`output`, `gen_ai.input`/`output.messages`,
log-record `body`) at `IO_PREVIEW_BYTES` (64 KB, configurable via
`LANGWATCH_IO_PREVIEW_BYTES`) when folding into `trace_summaries` / `stored_spans`,
and replaces the overflow with a `langwatch.reserved.eventref.<attrKey>` pointer to
the full value in `event_log` — the durable, unbounded source of truth. A "preview"
(what the fast projections store) and the "full value" (what `event_log` holds) are
different things by design, not by bug. See
`dev/docs/adr/022-event-log-source-of-truth.md` for the write-time mechanism
(`leanForProjection`, the `release_trace_blob_offload` flag). This doc covers the
READ side: how a call site restores the full value, and the rules that keep that
resolution safe and consistent.

## Resolving at read time

| Function | File | Scope |
|---|---|---|
| `resolveOffloadedTraces` | `src/server/traces/resolve-offloaded-traces.ts` | one trace's spans |
| `resolveOffloadedTracesBatch` | `src/server/traces/resolve-offloaded-traces-batch.ts` | a whole result set — dedupes identical `(aggregateId, eventId, field)` refs, bounds concurrency at `EVENT_LOG_RESOLVE_CONCURRENCY = 25` |

Both: find `langwatch.reserved.eventref.*` pointers on span attributes, fetch the
full value via `blobStore.getFromEventLog({ eventId, field, tenantId, aggregateType, aggregateId })`,
replace the preview, strip the reserved keys, and recompute trace-level input/output
from the resolved spans.

**Error policy: never throw, always fall back to the preview.** A missing/failed
`event_log` row (`BlobNotFoundError`, `BlobFieldNotFoundError`, or anything else the
fetch throws) logs at `warn` and leaves that field's preview in place — a stale or
malformed ref must not break a trace read. When nothing resolves, both functions
return `anyResolved: false` so the caller leaves the stored value untouched.

### Call sites

- **`TraceSummaryService.getByTraceId`** — unconditional, whenever blob-resolution
  deps are wired (`src/server/app-layer/traces/trace-summary.service.ts`).
- **`TraceListService.getList`** — opt-in via `ListParams.resolveFullIO`
  (`src/server/app-layer/traces/trace-list.service.ts`; see below).
- **`SpanStorageService.getSpansByTraceId` / `getSpanById`** — unconditional,
  whenever blob-resolution deps are wired
  (`src/server/app-layer/traces/span-storage.service.ts`).

All three no-op (return the stored preview untouched) when no span in scope
carries an eventref, or when the service wasn't constructed with resolution deps.

## Reuse the fold's own winner-selection

A resolved span's IO isn't enough on its own — the recomputed TRACE-level
`computedInput`/`computedOutput` (which span's IO becomes the headline) must agree
with what the write-time fold already chose. Read-time recompute goes through
`recomputeTraceIO`
(`src/server/event-sourcing/pipelines/trace-processing/projections/services/trace-io-accumulation.service.ts`),
which folds `TraceIOAccumulationService.accumulateIO` — the SAME function the
write-time projection uses — over the resolved spans.

**Never write a second winner-selection algorithm for a read path.** This exact bug
shipped once on this branch: the read path originally recomputed via
`TraceIOExtractionService.extractFirstInput`/`extractLastOutput`, a different
algorithm from the fold's `accumulateIO`. The two disagreed on the simplest
multi-span trace (root span plus a later-ending child — the fold keeps the root,
`extractLastOutput` returned the child) and on exclusion (`accumulateIO` excludes
tool/evaluation/guardrail/Claude-Code-utility spans from the headline I/O;
`extractLastOutput` did not). The read path could silently resolve a *different*
span's content than the fold's actual winner — worse than the truncation it was
fixing, because it looks confident but is wrong. Any future read-time recompute
goes through `recomputeTraceIO`, never a hand-rolled selection.

## `tracesV2.list` stays preview-only by default

`tracesV2.list` (backed by `TraceListService.getList`) serves two surfaces:

- **`TraceTable`** (the trace grid) — must never trigger an `event_log` read; the
  `trace_summaries` preview is enough for a list row.
- **The drawer's Conversation tab**
  (`src/features/traces-v2/hooks/useConversationTurns.ts`) — renders each turn's
  full message, so it needs the complete content.

`ListParams.resolveFullIO` (boolean, unset/falsy by default) is the switch.
`useConversationTurns` is the only caller that sets it `true`; every other caller,
the grid included, omits it and gets the preview-only, zero-`event_log`-read path
(#5835 AC5).

**Rule for any new `tracesV2.list` caller: leave `resolveFullIO` unset.** Opt in
only when the surface genuinely renders full content — not a snippet — and can
accept an `event_log` read per row it resolves. Setting it on a list/grid surface
reintroduces the read cost the flag exists to avoid.

## Resolve before gating, always

Two read paths apply a visibility-window gate that teaser-redacts content from
traces older than the caller's plan cutoff — `redactedByVisibilityWindow` /
`teaserOf` in `trace-summary.service.ts`, `applyVisibilityGate` in
`span-storage.service.ts`. Both run ADR-022 resolution FIRST and gate the resolved
result:

- `TraceSummaryService.getByTraceId`: `resolveOffloadedIO(...)` runs, then
  `teaserOf(...)` applies to the resolved value if the trace is pre-cutoff.
- `SpanStorageService.getSpansByTraceId`/`getSpanById`: `resolveOffloadedTraces(...)`
  runs, then `applyVisibilityGate(...)` applies to the resolved, mapped spans.

**Any new resolution or overlay logic MUST run before the visibility gate — never
after, never in parallel.** Reason: a pre-cutoff trace has to be teased on the
*resolved* value. Gate-then-resolve (or resolve-in-parallel-without-re-gating) lets
a full value restored from `event_log` bypass the teaser and leak past the privacy
boundary the gate exists to enforce.

## Flag incomplete content, don't infer it

When resolution fails and a preview stays in place, the caller sets a boolean flag
SERVER-SIDE — never inferred client-side (e.g. by string length):

| Flag | Consumer | File |
|---|---|---|
| `trace.inputTruncated` / `outputTruncated` | Summary tab | `traceAccordions/TraceSummaryAccordions.tsx` |
| `turn.inputTruncated` / `outputTruncated` | Conversation tab | `conversationView/ChatTurnRow.tsx` |
| `detail.hasIncompleteAttributes` | Attributes pane | `traceAccordions/SpanAccordions.tsx` |

(All three paths are under `src/features/traces-v2/components/TraceDrawer/`.)

Every flag drives the same banner, `ContentIncompleteNotice`
(`src/components/ui/ContentPrivacyMarkers.tsx`):

```tsx
<Alert.Root status="warning" size="sm" variant="subtle" width="full">
  <Alert.Indicator />
  <Alert.Content>
    <Alert.Description fontSize="sm">
      Some content could not be fully loaded, so you may be seeing only part of it.
    </Alert.Description>
  </Alert.Content>
</Alert.Root>
```

This is the SECOND instance of this exact shape — `ContentIncompleteNotice`'s
sibling `PiiIncompleteNotice` (same file) already pairs a server-computed boolean
with this banner, for incomplete PII redaction. Treat it as an established
convention: the next "X may be incomplete" case adds another server-computed
boolean flag and reuses `Alert.Root status="warning" size="sm" variant="subtle"` —
it does not invent a new visual.

## Code review checklist

- New `tracesV2.list` caller? `resolveFullIO` defaults off; only set it when the
  surface renders full content.
- New read-time IO recompute? Goes through `recomputeTraceIO`
  (`TraceIOAccumulationService.accumulateIO`) — never a second selection algorithm.
- New resolution/overlay logic on a gated read path? Runs before the visibility
  gate, not after.
- New "content may be incomplete" case? A server-computed boolean flag +
  `ContentIncompleteNotice`'s `Alert.Root status="warning" size="sm" variant="subtle"`
  shape.
- New blob-store fetch on a read path? Logs at `warn` and keeps the preview on
  failure — never throws.

## Reference implementation

- Read-time resolution: `src/server/traces/resolve-offloaded-traces.ts`,
  `resolve-offloaded-traces-batch.ts`
- Winner-consistency:
  `src/server/event-sourcing/pipelines/trace-processing/projections/services/trace-io-accumulation.service.ts`
  (`accumulateIO`, `recomputeTraceIO`)
- Call sites: `src/server/app-layer/traces/trace-summary.service.ts`,
  `trace-list.service.ts`, `span-storage.service.ts`
- Grid vs. Conversation tab: `src/features/traces-v2/hooks/useConversationTurns.ts`
- Incomplete-content banner: `src/components/ui/ContentPrivacyMarkers.tsx`
- Architecture: ADR-022 (`dev/docs/adr/022-event-log-source-of-truth.md`)
