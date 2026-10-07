/** One usage-billing fact as the judge holds it or folds it. */
export type InstantEvalJudgeUsageBillingFact = Readonly<{
  usageBilled: boolean;
  occurredAtMs: number;
  fromCatchUp: boolean;
}>;

/**
 * Whether a folded fact replaces the one the judge holds: the newest stamp wins, and on a tie a
 * real fact wins over a catch-up (ADR-174 decision 17). Billing stamps a real fact after its write
 * commits and a catch-up at its read, so a catch-up read before a change never overrides it.
 */
export function usageBillingFactWins({
  held,
  incoming,
}: {
  held: InstantEvalJudgeUsageBillingFact | null;
  incoming: InstantEvalJudgeUsageBillingFact;
}): boolean {
  if (held === null) return true;
  if (incoming.occurredAtMs !== held.occurredAtMs) {
    return incoming.occurredAtMs > held.occurredAtMs;
  }
  return held.fromCatchUp && !incoming.fromCatchUp;
}
