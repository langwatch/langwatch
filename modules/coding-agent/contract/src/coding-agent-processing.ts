import { z } from "zod";

/**
 * Contribution payloads (ADR-056 §2): lifted off each source signal, keyed
 * by SESSION. Content never rides here — prompts, replies and output stay
 * in the span/log rows; only lengths, ids, names and counters travel.
 */

/** A lifted scalar fact. Anything structured stays in the source row. */
const scalarFactSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * The lifted scalar vocabulary — raw wire keys, scalar values only, matching
 * `CODING_AGENT_CONTRIBUTION_KEYS`. Preserving the raw names keeps the fold's
 * derivation identical across signals.
 */
export const contributionFactsSchema = z.record(z.string(), scalarFactSchema);
export type ContributionFacts = z.infer<typeof contributionFactsSchema>;

/**
 * How the session key was established. `provider` is the agent's own key
 * (`session.id` / `gen_ai.conversation.id`); `trace_fallback` means the
 * telemetry carried none, so the trace id stands in (ADR-056 §1).
 */
export const sessionKeySourceSchema = z.enum(["provider", "trace_fallback"]);
export type SessionKeySource = z.infer<typeof sessionKeySourceSchema>;

const contributionBaseSchema = z.object({
  tenantId: z.string().min(1),
  /** The aggregate id: the normalized session key (or the fallback trace id). */
  sessionId: z.string().min(1),
  sessionKeySource: sessionKeySourceSchema,
  /**
   * The detected agent (`claude_code`, `claude_cowork`, `opencode`, `codex`,
   * `gemini_cli`, `copilot` — the ids in `../agents/`). Dispatchers gate on
   * detection, so `unknown` never reaches a contribution.
   */
  agent: z.string().min(1),
  occurredAt: z.number().int().positive(),
});

/**
 * The working context active when a record happened, stamped onto the event from the session's last
 * `session_context` declaration. Absent on pre-stamp events: a log's fact table stores '' and
 * prices under the legacy whole-session rule, and an unstamped model-call span charges no context.
 */
const workingContextStampSchema = {
  repositoryHost: z.string().optional(),
  repositoryOwner: z.string().optional(),
  repositoryName: z.string().optional(),
  branch: z.string().optional(),
};

/**
 * Facts off one coding-agent SPAN: structure, timing, tokens, finish reason.
 * The span itself stays in span storage — `traceId`/`spanId` reach it.
 */
export const spanFactsContributionSchema = contributionBaseSchema.extend({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  /** The wire span name (`claude_code.tool`, `opencode.tool.bash`, …). */
  name: z.string().min(1),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  /**
   * OTLP numeric status enum (0 unset / 1 ok / 2 error) — never a string. PR
   * #5708's `=== "error"` string check could never match, folding every failed
   * tool as successful; this type makes that unrepresentable.
   */
  statusCode: z.number().int().min(0).max(2),
  /** Lifted scalar span attributes (raw wire keys). */
  facts: contributionFactsSchema,
  scopeName: z.string().nullable(),
  ...workingContextStampSchema,
});
export type SpanFactsContribution = z.infer<typeof spanFactsContributionSchema>;

/**
 * Facts off one coding-agent LOG record: the facts with no span — the denied
 * tool, the failed-and-retried call, the authoritative cost, the compaction.
 */
export const logFactsContributionSchema = contributionBaseSchema.extend({
  /** The canonical record's content hash — reaches the stored row. */
  recordId: z.string().min(1),
  /** CorrelationTraceId (wire or synthesized); null when none resolved. */
  traceId: z.string().nullable(),
  spanId: z.string().nullable(),
  timeUnixMs: z.number(),
  severityNumber: z.number().int().nullable(),
  providerKind: z.string(),
  scopeName: z.string().nullable(),
  /** The lifted scalar vocabulary (`CODING_AGENT_CONTRIBUTION_KEYS`). */
  facts: contributionFactsSchema,
  ...workingContextStampSchema,
});
export type LogFactsContribution = z.infer<typeof logFactsContributionSchema>;

/**
 * Converged totals for one metric SERIES of a session (ADR-056 §5). The value
 * is the series' total as of `asOfUnixMs`, never a delta; re-delivery
 * replaces (last-write-wins), never adds — the rule that makes replay safe.
 */
export const metricFactsContributionSchema = contributionBaseSchema.extend({
  /** The canonical metric pipeline's series identity hash. */
  seriesId: z.string().min(1),
  /** The wire metric name (`claude_code.lines_of_code.count`, …). */
  metricName: z.string().min(1),
  unit: z.string().nullable(),
  /**
   * The series' identity attributes (low-cardinality by construction:
   * `type`, `decision`, `language`, `model`, `tool_name`, …).
   */
  attributes: contributionFactsSchema,
  /** The converged total for this series. Replaces; never increments. */
  value: z.number(),
  /** Datapoints folded into the converged value, for observability. */
  dataPointCount: z.number().int().nonnegative(),
  /** Wall-clock of the newest point folded in — the LWW version. */
  asOfUnixMs: z.number(),
});
export type MetricFactsContribution = z.infer<typeof metricFactsContributionSchema>;
