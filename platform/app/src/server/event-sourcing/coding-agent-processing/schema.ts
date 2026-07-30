import { z } from "zod";

/** A lifted scalar fact. Anything structured stays in the source row. */
const scalarFactSchema = z.union([z.string(), z.number(), z.boolean()]);

export const contributionFactsSchema = z.record(z.string(), scalarFactSchema);
export type ContributionFacts = z.infer<typeof contributionFactsSchema>;

/**
 * How the session key was established. `provider` is the agent's own key
 * (`session.id` / `gen_ai.conversation.id`); `trace_fallback` means the
 * telemetry carried no session key, so the trace id stands in.
 */
export const sessionKeySourceSchema = z.enum(["provider", "trace_fallback"]);
export type SessionKeySource = z.infer<typeof sessionKeySourceSchema>;

const contributionBaseSchema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionKeySource: sessionKeySourceSchema,
  /** The detected agent: `claude_code`, `claude_cowork`, `opencode`, `codex`, `gemini_cli`, `copilot`. */
  agent: z.string().min(1),
  occurredAt: z.number().int().positive(),
  /**
   * Our own ingest stamp, set once at dispatch — never `occurredAt`, which is
   * customer-stamped and orders nothing (ADR-099). Every last-write-wins field
   * in the identity fold compares against it.
   */
  acceptedAt: z.number().int().positive(),
});

export const spanFactsContributionSchema = contributionBaseSchema.extend({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  name: z.string().min(1),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  /** The OTLP numeric status enum (0 unset / 1 ok / 2 error) — never a string. */
  statusCode: z.number().int().min(0).max(2),
  facts: contributionFactsSchema,
  scopeName: z.string().nullable(),
});
export type SpanFactsContribution = z.infer<typeof spanFactsContributionSchema>;

export const logFactsContributionSchema = contributionBaseSchema.extend({
  /** The canonical record's content hash — reaches the stored row. */
  recordId: z.string().min(1),
  traceId: z.string().nullable(),
  spanId: z.string().nullable(),
  timeUnixMs: z.number(),
  severityNumber: z.number().int().nullable(),
  providerKind: z.string(),
  scopeName: z.string().nullable(),
  facts: contributionFactsSchema,
});
export type LogFactsContribution = z.infer<typeof logFactsContributionSchema>;

/**
 * One metric SERIES of a session, carrying the series' converged total as of
 * `asOfUnixMs` — never a delta, so a re-delivery replaces rather than adds.
 */
export const metricFactsContributionSchema = contributionBaseSchema.extend({
  seriesId: z.string().min(1),
  metricName: z.string().min(1),
  unit: z.string().nullable(),
  attributes: contributionFactsSchema,
  value: z.number(),
  dataPointCount: z.number().int().nonnegative(),
  /** The series' own version, distinct from `acceptedAt`. */
  asOfUnixMs: z.number(),
});
export type MetricFactsContribution = z.infer<
  typeof metricFactsContributionSchema
>;

/** One thing the agent did, in the order it did it. Back-to-back runs of the same tool batch into one step. */
const sessionStepSchema = z.object({
  name: z.string(),
  count: z.number(),
  failed: z.boolean(),
  startedAtMs: z.number(),
});
export type SessionStep = z.infer<typeof sessionStepSchema>;

/**
 * One converged metric unit, as its contribution delivered it. A cumulative
 * series is one unit (its latest total wins); a delta point is its own unit.
 * Replace-not-increment.
 */
const metricSeriesFactSchema = z.object({
  metricName: z.string(),
  type: z.string().nullable(),
  decision: z.string().nullable(),
  language: z.string().nullable(),
  value: z.number(),
});
export type MetricSeriesFact = z.infer<typeof metricSeriesFactSchema>;

/**
 * The full session-summary fold state, faithfully matching the deployed
 * `coding_agent_sessions` row (migrations 00051/00053/00054) — this pipeline's
 * conversion report explains why an identity-only redesign was tried and then
 * reverted. Light and bounded by construction: every field is a scalar, a
 * bounded set, or a small map keyed by a low-cardinality name; nothing here
 * carries a prompt, a reply or raw tool output — those stay in the spans, the
 * log records and the blob store, reached by id.
 */
export const codingAgentSessionStateSchema = z.object({
  agent: z.string().nullable(),
  sessionId: z.string().nullable(),
  agentVersion: z.string().nullable(),
  terminalType: z.string().nullable(),
  entrypoint: z.string().nullable(),
  finalRequestId: z.string().nullable(),
  userId: z.string().nullable(),
  sessionKeySource: z.string(),
  /** Every trace that contributed — bounded, first-seen order. */
  traceIds: z.array(z.string()),

  modelCalls: z.number(),
  toolCalls: z.number(),
  subAgents: z.number(),
  /** Bookkeeping only, not projected to the row: the dedup set behind `subAgents`. */
  subAgentIds: z.array(z.string()),
  steps: z.array(sessionStepSchema),
  prompts: z.number(),
  promptChars: z.number(),
  responseChars: z.number(),

  toolCounts: z.record(z.string(), z.number()),
  toolDurationMs: z.record(z.string(), z.number()),
  filesTouched: z.array(z.string()),
  skills: z.array(z.string()),
  subAgentTypes: z.array(z.string()),
  slashCommands: z.array(z.string()),
  models: z.array(z.string()),
  mcpServers: z.array(z.string()),
  mcpTools: z.array(z.string()),

  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  costUsd: z.number(),

  modelCallMs: z.number(),
  toolMs: z.number(),
  ttftMsTotal: z.number(),
  ttftSamples: z.number(),
  blockedOnUserMs: z.number(),
  activeTimeUserSec: z.number(),
  activeTimeCliSec: z.number(),

  toolResultBytes: z.number(),
  toolInputBytes: z.number(),
  compactions: z.number(),
  compactionTokensBefore: z.number(),
  compactionTokensAfter: z.number(),
  peakContextTokens: z.number(),
  cacheRebuildCount: z.number(),
  largestCacheRebuildTokens: z.number(),
  /** Bookkeeping only, not projected to the row: the previous model call's context size. */
  previousCallContextTokens: z.number(),

  failedTools: z.number(),
  errorTypes: z.record(z.string(), z.number()),
  apiErrors: z.number(),
  rateLimited: z.number(),
  retriesExhausted: z.number(),
  retryMs: z.number(),
  attempts: z.number(),
  refusals: z.number(),
  refusalCategories: z.array(z.string()),
  internalErrors: z.number(),

  toolsDenied: z.number(),
  toolsAborted: z.number(),
  permissionMode: z.string().nullable(),
  permissionChanges: z.number(),
  hooksBlocked: z.number(),
  hooksCancelled: z.number(),
  hookMs: z.number(),

  /** Bookkeeping only, not projected to the row: the converged metric units the fields below are recomputed from, keyed by seriesId. */
  metricSeries: z.record(z.string(), metricSeriesFactSchema),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  commits: z.number(),
  pullRequests: z.number(),
  editsAccepted: z.number(),
  editsRejected: z.number(),
  languagesEdited: z.array(z.string()),
  atMentions: z.number(),

  stopReason: z.string().nullable(),
  truncated: z.boolean(),

  /** Earliest span/log/metric start time seen. 0 is the "no spans yet" sentinel. */
  startedAtMs: z.number(),
  /** Out-of-order checkpoint: max(prev, event.occurredAt) on every apply. Not projected as its own column beyond the row's own bookkeeping. */
  LastEventOccurredAt: z.number(),
});
export type CodingAgentSessionState = z.infer<typeof codingAgentSessionStateSchema>;

/**
 * One `(traceId -> sessionId)` mapping: the seam the trace drawer seeks on.
 * Deployed `coding_agent_trace_sessions` (migration 00051) has no AcceptedAt
 * column — only OccurredAt, which is also its partition column.
 */
export const codingAgentTraceSessionSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  sessionId: z.string(),
  occurredAt: z.number(),
});
export type CodingAgentTraceSession = z.infer<
  typeof codingAgentTraceSessionSchema
>;

/**
 * One converged metric unit of a session (migration 00052): the LWW
 * projection behind `session_metric_series`. A re-observed cumulative total
 * writes a newer version of its series row; a delta point is its own row.
 */
export const sessionMetricSeriesRecordSchema = z.object({
  tenantId: z.string(),
  sessionId: z.string(),
  seriesId: z.string(),
  metricName: z.string(),
  metricUnit: z.string(),
  agent: z.string(),
  /** The overlay's `type`/`decision`/`language` dimensions only — never a raw provider attribute (PERSISTED_ATTRIBUTE_KEYS). */
  attributes: z.record(z.string(), z.string()),
  value: z.number(),
  dataPointCount: z.number().int().nonnegative(),
  /** Observation time of the newest folded point — the LWW version. */
  asOfUnixMs: z.number(),
});
export type SessionMetricSeriesRecord = z.infer<
  typeof sessionMetricSeriesRecordSchema
>;
