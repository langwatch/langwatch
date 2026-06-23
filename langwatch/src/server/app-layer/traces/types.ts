import { z } from "zod";

export const spanInsertDataSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  parentTraceId: z.string().nullable(),
  parentIsRemote: z.boolean().nullable(),
  sampled: z.boolean(),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  durationMs: z.number(),
  name: z.string(),
  kind: z.number(),
  resourceAttributes: z.record(z.unknown()),
  spanAttributes: z.record(z.unknown()),
  statusCode: z.number().nullable(),
  statusMessage: z.string().nullable(),
  instrumentationScope: z.object({
    name: z.string(),
    version: z.string().nullable().optional(),
  }),
  events: z.array(
    z.object({
      name: z.string(),
      timeUnixMs: z.number(),
      attributes: z.record(z.unknown()),
    }),
  ),
  links: z.array(
    z.object({
      traceId: z.string(),
      spanId: z.string(),
      attributes: z.record(z.unknown()),
    }),
  ),
  droppedAttributesCount: z.number(),
  droppedEventsCount: z.number(),
  droppedLinksCount: z.number(),
  retentionDays: z.number().optional().default(0),
});

export type SpanInsertData = z.infer<typeof spanInsertDataSchema>;

export const traceSummaryDataSchema = z.object({
  traceId: z.string(),
  spanCount: z.number(),
  totalDurationMs: z.number(),
  computedIOSchemaVersion: z.string(),
  computedInput: z.string().nullable(),
  computedOutput: z.string().nullable(),
  timeToFirstTokenMs: z.number().nullable(),
  timeToLastTokenMs: z.number().nullable(),
  tokensPerSecond: z.number().nullable(),
  containsErrorStatus: z.boolean(),
  containsOKStatus: z.boolean(),
  errorMessage: z.string().nullable(),
  models: z.array(z.string()),
  totalCost: z.number().nullable(),
  // Bundled portion of totalCost, summed per span at fold time (a span whose
  // langwatch.cost.non_billable marker is set is covered by a flat plan, not
  // billed per token). Billed = totalCost - nonBilledCost. Null for rows
  // folded before the column existed; the read layer falls back to the legacy
  // trace-level boolean for those.
  nonBilledCost: z.number().nullable(),
  tokensEstimated: z.boolean(),
  totalPromptTokenCount: z.number().nullable(),
  totalCompletionTokenCount: z.number().nullable(),
  outputFromRootSpan: z.boolean(),
  outputSpanEndTimeMs: z.number(),
  blockedByGuardrail: z.boolean(),
  rootSpanType: z.string().nullable(),
  containsAi: z.boolean(),
  containsPrompt: z.boolean(),
  selectedPromptId: z.string().nullable(),
  selectedPromptSpanId: z.string().nullable(),
  /** Tracks the latest source span's startTimeUnixMs — internal bookkeeping
   * to disambiguate which span won the "latest" race. Not surfaced. */
  selectedPromptStartTimeMs: z.number().nullable(),
  lastUsedPromptId: z.string().nullable(),
  lastUsedPromptVersionNumber: z.number().nullable(),
  lastUsedPromptVersionId: z.string().nullable(),
  lastUsedPromptSpanId: z.string().nullable(),
  lastUsedPromptStartTimeMs: z.number().nullable(),
  topicId: z.string().nullable(),
  subTopicId: z.string().nullable(),
  annotationIds: z.array(z.string()),
  /**
   * Stored payload size of the trace in bytes, read from the MATERIALIZED
   * `_size_bytes` column (CH-native `byteSize(...)`; see migration 00032).
   * Read-only projection: it is computed server-side and never written in
   * INSERTs (MATERIALIZED columns reject inserted values), so the write/
   * upsert path leaves it undefined — only the list read populates it.
   */
  sizeBytes: z.number().optional(),
  attributes: z.record(z.string()),
  traceName: z.string(),
  /** Start time of the root span that set traceName, used for deterministic tie-breaking when multiple root spans exist. Internal bookkeeping. */
  rootSpanStartTimeMs: z.number().optional(),
  /**
   * When true the user has explicitly renamed the trace via
   * `ChangeTraceNameCommand`, and the fold projection must NOT clobber
   * `traceName` from a later root-span arrival. Without this latch, a
   * delayed root span landing post-rename would wipe out the user's edit
   * the next time the projection re-folds.
   */
  traceNameUserOverridden: z.boolean().optional(),
  /**
   * True when `traceName` came from the "no real root, fall back to
   * earliest span" path rather than a span with `parentSpanId === null`.
   * Customers occasionally emit the first span with a bogus
   * `parent_span_id` that points to no span in the trace, so no real
   * root ever exists and the trace would otherwise stay unnamed. The
   * fallback lets it pick up a sensible name immediately; if a real
   * root span arrives later the projection prefers it and clears this
   * flag, since fold updates are incremental.
   *
   * Cleared by a user rename (TraceNameChanged event) — the rename is
   * itself a higher-precedence source of the name, so the "is this
   * still fallback-sourced?" question is meaningfully no.
   * `rootMetadataFromFallback` continues to track the metadata
   * provenance independently in that case.
   */
  traceNameFromFallback: z.boolean().optional(),
  /**
   * True when `rootSpanStartTimeMs` / `rootSpanType` were claimed via
   * the fallback path (a non-root span used as a stand-in because no
   * real root has arrived yet). Pairs with `traceNameFromFallback` but
   * outlives a user rename — a user-supplied name disowns the fallback
   * for *naming purposes* but the metadata itself is still a stand-in,
   * so a real root arriving later must still be allowed to take it
   * over.
   */
  rootMetadataFromFallback: z.boolean().optional(),
  occurredAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  LastEventOccurredAt: z.number(),
  // Set at read time when computed input/output/error were teaser-redacted
  // by the plan's visibility window (never persisted).
  redactedByVisibilityWindow: z.boolean().optional(),
});

export type TraceSummaryData = z.infer<typeof traceSummaryDataSchema>;
