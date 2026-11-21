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
 * The plan fold's state: the fact the copy holds and the fact event that last changed it, the one
 * whose delivery may tell Customer.io.
 */
export type NurturingPlanFoldState = Readonly<{
  held: NurturingPlanHeld;
  /** The id of the event that last changed the copy; null until one did. */
  winnerEventId: string | null;
  /**
   * Epoch ms of the latest fact folded, as the fold executor reads it. Always the held fact's own
   * stamp: a later fact always wins, so no folded fact is later than the held one.
   */
  LastEventOccurredAt: number;
}>;

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

/** The plan fold before any fact: no plan held, no winner. */
export function emptyPlanFold(): NurturingPlanFoldState {
  return { held: { outcome: "none" }, winnerEventId: null, LastEventOccurredAt: 0 };
}

/** A subscription fact as the plan copy folds it; a fact stored before plans names none. */
export function planFactOf({
  plan,
  occurredAt,
  fromCatchUp,
}: Readonly<{ plan?: string; occurredAt: number; fromCatchUp?: boolean }>): NurturingPlanFact {
  return { plan: plan ?? null, occurredAt, fromCatchUp: fromCatchUp ?? false };
}

/**
 * Folds one subscription fact into the plan copy: a fact that changes it, by
 * `planFactChangesCopy`, is held and its event becomes the winner; any other leaves the state as it
 * was, its winner included. Pure, so a replay rebuilds the row live delivery wrote.
 */
export function foldPlanFact(
  state: NurturingPlanFoldState,
  { eventId, fact }: Readonly<{ eventId: string; fact: NurturingPlanFact }>,
): NurturingPlanFoldState {
  if (!planFactChangesCopy({ held: state.held, incoming: fact })) return state;
  return {
    held: { outcome: "held", fact },
    winnerEventId: eventId,
    LastEventOccurredAt: fact.occurredAt,
  };
}
