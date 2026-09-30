/** The Langy canary's verdict and answer, from main's `health-probes/langy-canary.service.ts`. */
import type { LangyTurnSettlementWait } from "@langwatch/langy-contract";

import { probeCauseOf } from "./probe-cause.rules.ts";

/** Wall-time budget for one check: under the 60s a plain HTTP monitor allows. */
export const LANGY_CANARY_BUDGET_MS = 55_000;

/** The one user message every check sends. */
export const LANGY_CANARY_GREETING = "Hi Langy.";

export type LangyCanaryReason = "timeout" | "turn_failed" | "empty_reply";

export type LangyCanaryVerdict =
  | { healthy: true }
  | { healthy: false; reason: LangyCanaryReason; cause?: string };

export type LangyCanaryOutcome = LangyCanaryVerdict & {
  conversationId?: string;
  turnId?: string;
  durationMs: number;
};

export type LangyCanaryResult = LangyCanaryOutcome | { busy: true };

/**
 * A wait the budget ended is `timeout`. A failed or stopped turn is `turn_failed` (nobody stops a
 * canary turn, so a stop is the worker giving up); a blank reply is `empty_reply`. A turn that
 * answered with a question card and waits on the user is healthy.
 */
export function classifyLangyCanaryOutcome(
  wait: LangyTurnSettlementWait | null,
): LangyCanaryVerdict {
  if (!wait || wait.kind === "stopped") return { healthy: false, reason: "timeout" };
  if (wait.kind === "awaiting_user") return { healthy: true };
  const { settlement } = wait;
  if (!settlement.succeeded) {
    const cause = probeCauseOf(settlement.error);
    return { healthy: false, reason: "turn_failed", ...(cause && { cause }) };
  }
  if (settlement.outcome !== "completed") {
    return { healthy: false, reason: "turn_failed", cause: "turn_stopped" };
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
    body: {
      status: "unhealthy",
      reason: result.reason,
      ...(result.cause && { cause: result.cause }),
      conversationId,
      turnId,
      durationMs,
    },
  };
}
