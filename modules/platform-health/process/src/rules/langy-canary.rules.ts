/** The Langy canary's verdict and answer, from main's `health-probes/langy-canary.service.ts`. */
import type { LangyTurnSettlement } from "@langwatch/langy-contract";

/** Wall-time budget for one check: under the 60s a plain HTTP monitor allows. */
export const LANGY_CANARY_BUDGET_MS = 55_000;

/** The one user message every check sends. */
export const LANGY_CANARY_GREETING = "Hi Langy.";

export type LangyCanaryReason = "timeout" | "turn_failed" | "empty_reply";

export type LangyCanaryVerdict = { healthy: true } | { healthy: false; reason: LangyCanaryReason };

export type LangyCanaryOutcome = LangyCanaryVerdict & {
  conversationId?: string;
  turnId?: string;
  durationMs: number;
};

export type LangyCanaryResult = LangyCanaryOutcome | { busy: true };

/**
 * `null` is a wait the budget ended: `timeout`. A failed or stopped turn is `turn_failed` (nobody
 * stops a canary turn, so a stop is the worker giving up); a blank reply is `empty_reply`.
 */
export function classifyLangyCanaryOutcome(
  settlement: LangyTurnSettlement | null,
): LangyCanaryVerdict {
  if (!settlement) return { healthy: false, reason: "timeout" };
  if (!settlement.succeeded || settlement.outcome !== "completed") {
    return { healthy: false, reason: "turn_failed" };
  }
  if (settlement.text.trim().length === 0) return { healthy: false, reason: "empty_reply" };
  return { healthy: true };
}

/** Main's `langyCanaryResultToResponse`: 429 busy, 200 ok, 503 with the named reason. */
export function langyCanaryAnswer(result: LangyCanaryResult): { status: number; body: unknown } {
  if ("busy" in result) return { status: 429, body: { status: "busy" } };
  const { conversationId, turnId, durationMs } = result;
  if (result.healthy)
    return { status: 200, body: { status: "ok", conversationId, turnId, durationMs } };
  return {
    status: 503,
    body: { status: "unhealthy", reason: result.reason, conversationId, turnId, durationMs },
  };
}
