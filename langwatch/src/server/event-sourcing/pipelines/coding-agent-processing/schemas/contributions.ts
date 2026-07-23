import { z } from "zod";

/**
 * Contribution payloads (ADR-056 §2).
 *
 * Each source pipeline lifts the coding-agent facts off its own signal and
 * dispatches them here, keyed by the SESSION. Content never rides in a
 * contribution: prompts, replies and tool output stay in the canonical
 * span/log rows; these carry lengths, ids, names and counters only.
 */

/** A lifted scalar fact. Anything structured stays in the source row. */
const scalarFactSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * The lifted scalar vocabulary — raw wire keys, values scalar-only. The keys
 * are the ones `CODING_AGENT_CONTRIBUTION_KEYS` enumerates for logs and the
 * session derivation reads for spans; preserving the raw names keeps the
 * fold's derivation identical across signals.
 */
export const contributionFactsSchema = z.record(z.string(), scalarFactSchema);
export type ContributionFacts = z.infer<typeof contributionFactsSchema>;

/**
 * How the session key was established. `provider` is the agent's own key
 * (`session.id` / `gen_ai.conversation.id` — identical values, different
 * spellings). `trace_fallback` means the telemetry carried no session key, so
 * the trace id stands in and the session is a one-trace session (ADR-056 §1).
 */
export const sessionKeySourceSchema = z.enum(["provider", "trace_fallback"]);
export type SessionKeySource = z.infer<typeof sessionKeySourceSchema>;

const contributionBaseSchema = z.object({
  tenantId: z.string().min(1),
  /** The aggregate id: the normalized session key (or the fallback trace id). */
  sessionId: z.string().min(1),
  sessionKeySource: sessionKeySourceSchema,
  /**
   * The detected agent (`claude_code`, `opencode`, `codex`, `gemini_cli`,
   * `copilot`). Dispatchers gate on detection, so `unknown` never reaches a
   * contribution.
   */
  agent: z.string().min(1),
  occurredAt: z.number().int().positive(),
});

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
   * The OTLP numeric status enum (0 unset / 1 ok / 2 error) — NEVER a string.
   * PR #5708 shipped a `=== "error"` comparison that could not be true, so
   * every failed tool folded as successful; the type here makes that
   * unrepresentable.
   */
  statusCode: z.number().int().min(0).max(2),
  /** Lifted scalar span attributes (raw wire keys). */
  facts: contributionFactsSchema,
  scopeName: z.string().nullable(),
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
});
export type LogFactsContribution = z.infer<typeof logFactsContributionSchema>;

/**
 * Converged totals for one metric SERIES of a session (ADR-056 §5).
 *
 * The value is the series' converged total as of `asOfUnixMs` — never a
 * delta. Re-delivery replaces (last-write-wins per series); it never adds.
 * That single rule is what makes metric replay safe.
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
export type MetricFactsContribution = z.infer<
  typeof metricFactsContributionSchema
>;
