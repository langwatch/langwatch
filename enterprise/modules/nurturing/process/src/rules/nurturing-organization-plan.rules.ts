// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One subscription fact as nurturing's plan copy holds it or folds it. */
export type NurturingPlanFact = Readonly<{
  /** Billing's plan type; null on a fact billing stored before it carried one. */
  plan: string | null;
  /** Epoch ms of billing's stamp. */
  occurredAt: number;
  fromCatchUp: boolean;
}>;

/** The plan copy one read gave: the fact it holds, or none yet. */
export type NurturingPlanHeld =
  | Readonly<{ outcome: "held"; fact: NurturingPlanFact }>
  | Readonly<{ outcome: "none" }>;

/**
 * Whether a subscription fact changes nurturing's plan copy, as ADR-174 decision 17 folds billing's
 * facts: the newest stamp wins, and a real fact wins a tie over a catch-up. So a newer catch-up
 * corrects a wrong plan, and on any other tie the held fact stays.
 */
export function planFactChangesCopy({
  held,
  incoming,
}: Readonly<{ held: NurturingPlanHeld; incoming: NurturingPlanFact }>): boolean {
  if (held.outcome === "none") return true;
  if (incoming.occurredAt !== held.fact.occurredAt) {
    return incoming.occurredAt > held.fact.occurredAt;
  }
  return held.fact.fromCatchUp && !incoming.fromCatchUp;
}
