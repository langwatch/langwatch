import { z } from "zod";

/** What the ledger knows about writers that predate the roster, stamped by the database clock. */
export const preRosterHistorySchema = z.object({
  now: z.date(),
  /** The seed run's start when it inferred steps from an existing installation; else null. */
  seededFromExistingAt: z.date().nullable(),
  rollbacksAt: z.array(z.date()),
  assertionsAt: z.array(z.date()),
  /** Finish times of the succeeded upgrade runs. */
  upgradesFinishedAt: z.array(z.date()),
});
export type PreRosterHistory = z.infer<typeof preRosterHistorySchema>;

export type PreRosterVerdict =
  | { present: false; reason: "never" | "asserted" | "grace" }
  | { present: true; graceEndsAtMs: number };

/**
 * Round 47 E2 (ADR-173, amendment 2026-10-08): after the latest opening (an existing installation
 * seeded, or a recorded rollback), old writers count as present until an assertion follows it, or
 * the grace passes after the first upgrade run finished since (else the opening itself). Pure.
 */
export function preRosterWriters({
  history,
  graceMs,
}: {
  history: PreRosterHistory;
  graceMs: number;
}): PreRosterVerdict {
  const ms = (dates: PreRosterHistory["rollbacksAt"]) => dates.map((at) => at.getTime());
  const seeded = history.seededFromExistingAt?.getTime();
  const openings = [...(seeded === undefined ? [] : [seeded]), ...ms(history.rollbacksAt)];
  if (openings.length === 0) return { present: false, reason: "never" };
  const opened = Math.max(...openings);
  if (ms(history.assertionsAt).some((at) => at > opened)) {
    return { present: false, reason: "asserted" };
  }
  const after = ms(history.upgradesFinishedAt).filter((at) => at > opened);
  const anchor = after.length > 0 ? Math.min(...after) : opened;
  const graceEndsAtMs = anchor + graceMs;
  if (history.now.getTime() >= graceEndsAtMs) return { present: false, reason: "grace" };
  return { present: true, graceEndsAtMs };
}
