import { z } from "zod";

/**
 * The coding-agent session pipeline's event and command payloads.
 * The fold's own state holds identity only; every counted value is a query
 * over `coding_agent_session_contributions` (ADR-103).
 */

// ---------------------------------------------------------------------------
// Contribution payloads (unchanged in shape from the old pipeline's
// `schemas/contributions.ts` — the contract three source pipelines' bridges
// already produce; see `bridge/dispatch.ts`).
// ---------------------------------------------------------------------------

/** A lifted scalar fact. Anything structured stays in the source row. */
const scalarFactSchema = z.union([z.string(), z.number(), z.boolean()]);

/** The lifted scalar vocabulary — raw wire keys, values scalar-only. */
export const contributionFactsSchema = z.record(z.string(), scalarFactSchema);
export type ContributionFacts = z.infer<typeof contributionFactsSchema>;

/**
 * How the session key was established. `provider` is the agent's own key
 * (`session.id` / `gen_ai.conversation.id`). `trace_fallback` means the
 * telemetry carried no session key, so the trace id stands in.
 *
 * Resolved in exactly one place — {@link resolveCodingAgentSessionId} in
 * `sessionIdentity.ts` — never re-derived per signal type (trap: "the
 * session id is computed three ways with three give-up behaviours").
 */
export const sessionKeySourceSchema = z.enum(["provider", "trace_fallback"]);
export type SessionKeySource = z.infer<typeof sessionKeySourceSchema>;

const contributionBaseSchema = z.object({
  tenantId: z.string().min(1),
  /** The aggregate id: the normalized session key (or the fallback trace id). */
  sessionId: z.string().min(1),
  sessionKeySource: sessionKeySourceSchema,
  /** The detected agent (`claude_code`, `claude_cowork`, `opencode`, `codex`, `gemini_cli`, `copilot`). */
  agent: z.string().min(1),
  occurredAt: z.number().int().positive(),
  /**
   * Our own ingest stamp, set once by the bridge at dispatch time — never
   * `occurredAt`, which is customer-stamped and orders nothing (ADR-099).
   * Every last-write-wins field in the identity fold compares against it.
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
 * Converged totals for one metric SERIES of a session. The value is the
 * series' converged total as of `asOfUnixMs` — never a delta. Re-delivery
 * replaces (last-write-wins per series); it never adds — unchanged from the
 * old pipeline, which already got this right (`session_metric_series`,
 * migration 00052, `ReplacingMergeTree(AsOf)`).
 */
export const metricFactsContributionSchema = contributionBaseSchema.extend({
  seriesId: z.string().min(1),
  metricName: z.string().min(1),
  unit: z.string().nullable(),
  attributes: contributionFactsSchema,
  value: z.number(),
  dataPointCount: z.number().int().nonnegative(),
  /** Wall-clock of the newest point folded in — the metric series' OWN version, distinct from `acceptedAt`. */
  asOfUnixMs: z.number(),
});
export type MetricFactsContribution = z.infer<
  typeof metricFactsContributionSchema
>;

// ---------------------------------------------------------------------------
// The identity fold's state (ADR-098 decision 4, ADR-103)
// ---------------------------------------------------------------------------

/** One last-write-wins slot: a value, and the stamp it was accepted at. */
export const identitySlotSchema = z.object({
  value: z.string().nullable(),
  /** 0 means "never set" — no contribution has carried an opinion yet. */
  acceptedAt: z.number().int().nonnegative(),
});
export type IdentitySlot = z.infer<typeof identitySlotSchema>;

function emptySlot(): IdentitySlot {
  return { value: null, acceptedAt: 0 };
}

/**
 * The sparse identity slots: carried by some contributions, absent from
 * others. Each is its own last-write-wins slot, so a contribution that omits
 * one never blanks a value a previous contribution set.
 */
export const SPARSE_IDENTITY_SLOTS = [
  "agentVersion",
  "terminalType",
  "entrypoint",
  "finalRequestId",
  "userId",
  "permissionMode",
  "stopReason",
] as const;
export type SparseIdentitySlot = (typeof SPARSE_IDENTITY_SLOTS)[number];

export const codingAgentSessionIdentityStateSchema = z.object({
  sessionId: z.string().nullable(),

  // `agent`/`sessionKeySource` are universal — every contribution carries an
  // opinion on both — so they share one stamp and replace atomically. This
  // is the direct fix for the "agent/sessionKeySource mislabelling… first-
  // write-wins with no stamp" trap: whichever contribution was most
  // recently accepted decides the label, not whichever happened to fold
  // first.
  agent: z.string().nullable(),
  sessionKeySource: sessionKeySourceSchema.nullable(),
  identityAcceptedAt: z.number().int().nonnegative(),

  agentVersion: identitySlotSchema,
  terminalType: identitySlotSchema,
  entrypoint: identitySlotSchema,
  finalRequestId: identitySlotSchema,
  userId: identitySlotSchema,
  permissionMode: identitySlotSchema,
  stopReason: identitySlotSchema,

  /**
   * Earliest span/log/metric-observation time seen for the session.
   * Commutative (`Math.min`), so it needs no stamp. `0` means no signal yet.
   * It moves, so it must not anchor the table's partition or sort key.
   */
  startedAtMs: z.number().int().nonnegative(),

  /** Sticky true — a truncated reply stays truncated regardless of order. Commutative (logical OR). */
  truncated: z.boolean(),
});
export type CodingAgentSessionIdentityState = z.infer<
  typeof codingAgentSessionIdentityStateSchema
>;

export function initCodingAgentSessionIdentityState(): CodingAgentSessionIdentityState {
  return {
    sessionId: null,
    agent: null,
    sessionKeySource: null,
    identityAcceptedAt: 0,
    agentVersion: emptySlot(),
    terminalType: emptySlot(),
    entrypoint: emptySlot(),
    finalRequestId: emptySlot(),
    userId: emptySlot(),
    permissionMode: emptySlot(),
    stopReason: emptySlot(),
    startedAtMs: 0,
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// The item-grain contribution record (`contributions.ts`'s map projection output)
// ---------------------------------------------------------------------------

export const contributionKindSchema = z.enum(["span", "log", "metric"]);
export type ContributionKind = z.infer<typeof contributionKindSchema>;

/**
 * One row of `coding_agent_session_contributions`: one contribution,
 * independent of every other. Every count, sum and breakdown is a query over
 * these rows (ADR-103).
 */
export interface CodingAgentSessionContributionRecord {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly kind: ContributionKind;
  /** The source signal's own natural key: spanId, recordId, or seriesId. Deterministic — a redelivery re-derives the identical row. */
  readonly sourceId: string;
  readonly agent: string;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly occurredAt: number;
  readonly acceptedAt: number;
  /** The contribution's payload, verbatim, so a read-side query can derive
   *  any total without a second migration. */
  readonly payloadJson: string;
}
