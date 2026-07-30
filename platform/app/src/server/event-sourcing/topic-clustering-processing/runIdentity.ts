/**
 * Run identity and ranking (ADR-098 decision 4).
 *
 * A run id already carries a wall-clock instant by construction — see
 * `mintScheduledRunId`/`mintManualRunId` below — so "which of two runs is
 * newer" is a pure function of the two ids, needing no separately-tracked
 * timestamp and no assumption about delivery order. This is the one piece of
 * shared machinery every fold in this pipeline (`projections/`) and the
 * process manager (`process-manager/schedule.ts`) build their order-
 * invariance on: instead of "whichever run's event was applied most
 * recently wins" (order-DEPENDENT — the old
 * `topicClusteringRunStatus.foldProjection.ts`'s `sameRun` check and
 * `topicClusteringRunHistory.foldProjection.ts`'s `settleSuperseded` both
 * had this shape), every comparison here is "whichever run started later
 * wins" (order-INDEPENDENT: the same answer regardless of which event a
 * fold happened to see first).
 *
 * `runRank` is monotone by construction (a later-started run always has a
 * numerically larger rank), which is exactly ADR-098 decision 4's second
 * admissible field kind: "monotone by rank — `status = max(current,
 * incoming)` over a declared lattice."
 */

const MANUAL_RUN_ID_PATTERN = /^manual-(\d+)$/;
const SCHEDULED_RUN_ID_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;

/** A manual run's id: the instant the request was accepted, second-precision-
 * free (full millisecond) because a manual request has no slot to align to. */
export function mintManualRunId(requestedAtMs: number): string {
  return `manual-${requestedAtMs}`;
}

/**
 * A scheduled run's id: `20260717T093000`, from the instant the wake actually
 * started the run (second precision). The instant — not just the UTC date —
 * is part of the identity so two wakes can legitimately start runs on the
 * same day (an outage that crosses midnight makes the missed slot fire as a
 * catch-up at recovery, and the day's real slot still arrives hours later)
 * without minting colliding ids.
 */
export function mintScheduledRunId(slotMs: number): string {
  return new Date(slotMs).toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/**
 * The wall-clock instant a run id names, in epoch milliseconds.
 *
 * Returns `null` for a run id in neither minted shape — a row written by a
 * build that minted ids differently, or corrupt input — rather than
 * guessing. Callers treat `null` as "unrankable" (see {@link runIsNewer}),
 * never as rank zero: a rank of zero would make an unrecognised id lose
 * every comparison, silently discarding whatever it names instead of
 * falling back to a total order that at least does not depend on delivery.
 */
export function runRank(runId: string): number | null {
  const manual = MANUAL_RUN_ID_PATTERN.exec(runId);
  if (manual?.[1] !== undefined) {
    const ms = Number(manual[1]);
    return Number.isFinite(ms) ? ms : null;
  }

  const scheduled = SCHEDULED_RUN_ID_PATTERN.exec(runId);
  if (scheduled) {
    const [, y, mo, d, h, mi, s] = scheduled;
    const ms = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    );
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

/**
 * Whether `candidate` should be treated as strictly newer than `incumbent`.
 *
 * Ranked first by {@link runRank}; a tie (including a tie of two `null`
 * ranks) falls back to bytewise string comparison of the ids themselves, so
 * the function is a total, deterministic order regardless of how the two ids
 * were minted — the same property `utils/compareOrdinal.ts` gives event-id
 * comparison elsewhere in this system (ADR-098 decision 5: "Never
 * `localeCompare`"), applied here to run ids instead. A total order matters
 * even in the pathological case (two unrankable ids) because every fold that
 * uses this to decide "does this event supersede the current run" must reach
 * the *same* answer regardless of which of the two events it saw first —
 * `undefined`/inconsistent behaviour here would reopen the exact order-
 * dependency this module exists to close.
 */
export function runIsNewer(candidate: string, incumbent: string): boolean {
  if (candidate === incumbent) return false;
  const candidateRank = runRank(candidate);
  const incumbentRank = runRank(incumbent);
  if (
    candidateRank !== null &&
    incumbentRank !== null &&
    candidateRank !== incumbentRank
  ) {
    return candidateRank > incumbentRank;
  }
  if (candidateRank !== incumbentRank) {
    // Exactly one side is unrankable: prefer the rankable one deterministically,
    // rather than letting an unparseable id ever win by falling through to the
    // string compare below (which has no relationship to actual recency).
    return incumbentRank === null;
  }
  return candidate > incumbent;
}

/** `true` if `runId` looks like a manual (button/API) request rather than a
 * scheduled daily wake. Pure function of the id's own shape. */
export function isManualRun(runId: string): boolean {
  return MANUAL_RUN_ID_PATTERN.test(runId);
}
