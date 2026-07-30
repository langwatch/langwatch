import { z } from "zod";

/** Process name, as mounted on the trace pipeline. */
export const ORIGIN_GATE_PROCESS_NAME = "originGate";

export const ORIGIN_GATE_INTENT_TYPES = {
  RESOLVE_ORIGIN: "resolveOrigin",
} as const;

/**
 * How long a trace may go without an origin before the fallback is written.
 *
 * The same five minutes the hand-rolled deferral it replaced used, now
 * expressed as a durable deadline rather than a queue delay: it lives on the
 * process instance row, so a restart between arming and firing does not lose
 * it.
 *
 * **Coupled to `evaluationTrigger`**: that process manager sizes its
 * evaluation dedup TTL (`EVALUATION_REQUEST_DEDUP_TTL_MS`) at this window +
 * 60s, so a trace whose evaluation is triggered twice — once by a late span,
 * once by the resulting `origin_resolved` — dispatches one evaluation.
 * Shortening this without moving that TTL re-opens the duplicate-evaluation
 * window.
 */
export const ORIGIN_GATE_DEADLINE_MS = 5 * 60 * 1000;

/** The origin every un-attributed trace falls back to. */
export const ORIGIN_GATE_FALLBACK_ORIGIN = "application";

/** Recorded on the event so the fallback is distinguishable from a real signal. */
export const ORIGIN_GATE_FALLBACK_REASON = "deferred_fallback";

/**
 * Retries for the fallback write. `resolveOrigin` carries a deterministic
 * idempotency key and the fold refuses to override an origin it already has,
 * so a retried dispatch is a no-op rather than a second origin.
 */
export const ORIGIN_GATE_MAX_ATTEMPTS = 3;

/** One command dispatch; it does not need a long lease. */
export const ORIGIN_GATE_LEASE_DURATION_MS = 60_000;

/**
 * How often one trace may stage a gate job, per decision class.
 *
 * The reactor this replaced deduplicated on `origin-gate:{tenant}:{traceId}`
 * for 15 seconds, so a burst of spans cost one job; the process manager that
 * replaced it declared no enqueue options at all and so cost one job — and one
 * durable inbox row and transition — per span. Fifteen seconds is that window,
 * restored (ADR-098).
 *
 * Safe against the deadline it guards: the gate ARMS once and never re-arms,
 * and the deadline it arms is `ORIGIN_GATE_DEADLINE_MS` (five minutes), twenty
 * times this window. A collapsed burst can therefore only shift when the gate
 * arms, never whether it fires.
 */
export const ORIGIN_GATE_ENQUEUE_WINDOW_MS = 15_000;

/**
 * What the gate needs to remember between events. Deliberately three flags:
 * the trace's own content is none of the process's business (ADR-098), and
 * everything here is persisted verbatim into the instance row.
 */
export interface OriginGateState {
  /**
   * An origin is known for this trace — set by evidence on an event, by the
   * `origin_resolved` event, or by the wake that wrote the fallback itself.
   * A latch: an origin is never unset once the fold has one, so a straggling
   * span cannot re-open a gate that has closed.
   */
  resolved: boolean;
  /**
   * The armed deadline, or null. Held in state because `nextWakeAt` is
   * authoritative on every commit — a handler that returns nothing CLEARS the
   * wake, so each one has to re-state the deadline it is leaving alone.
   */
  deadlineAt: number | null;
  /**
   * A span on this trace named its instrumentation SDK. The fold's
   * SDK-presence heuristic reads the trace's accumulated attributes, not one
   * span's, so a root span that arrives after a child carrying the SDK marker
   * still resolves — this flag is what lets the process see the same thing.
   */
  sdkSeen: boolean;
}

export const INITIAL_ORIGIN_GATE_STATE: OriginGateState = {
  resolved: false,
  deadlineAt: null,
  sdkSeen: false,
};

/**
 * The content boundary. Trace events carry whole spans — prompts, completions,
 * tool output — and the default payload would persist every one of them into
 * the instance row and the outbox. The gate only ever asks three yes/no
 * questions, so those are the only three things that cross.
 */
export const originGateEventViewSchema = z.object({
  /**
   * Unambiguous evidence that this trace's origin is decided. Deliberately
   * CONSERVATIVE: a missed signal costs one fallback command the fold then
   * ignores (exactly today's behaviour, where the deferred job fires
   * unconditionally), whereas a false positive would leave a real OTEL trace
   * with no origin at all. When in doubt, say false.
   */
  originDecided: z.boolean(),
  /** A root span — the only place the SDK-presence heuristic applies. */
  isRootSpan: z.boolean(),
  /** This event's resource named an instrumentation SDK. */
  sdkPresent: z.boolean(),
});

export type OriginGateEventView = z.infer<typeof originGateEventViewSchema>;

/**
 * The fallback write. `traceId` is non-empty by construction — an empty
 * aggregate id would mint an `origin_resolved` event with an empty
 * aggregateId, which fails validation downstream in the automations pipeline.
 * The wake refuses to address a fallback at nothing, and this rejects it
 * loudly if that guard is ever removed.
 */
export const originGateResolveIntentSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
});

export type OriginGateResolveIntent = z.infer<
  typeof originGateResolveIntentSchema
>;
