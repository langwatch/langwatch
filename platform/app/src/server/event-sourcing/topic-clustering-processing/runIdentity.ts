/**
 * Run identity and ranking.
 *
 * A run id carries the instant it was minted, so "which of two runs is newer"
 * is a pure function of the two ids — no separately-tracked timestamp, and no
 * assumption about delivery order. Every fold and the process manager build
 * their order-invariance on that: "whichever run started later wins" gives the
 * same answer regardless of which event arrived first.
 */

const MANUAL_RUN_ID_PATTERN = /^manual-(\d+)$/;
const SCHEDULED_RUN_ID_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;

/** A manual run's id: the instant the request was accepted, at full
 * millisecond precision — a manual ask has no slot to align to. */
export function mintManualRunId(requestedAtMs: number): string {
  return `manual-${requestedAtMs}`;
}

/**
 * A scheduled run's id: `20260717T093000`, from the instant the wake started
 * the run. The instant rather than the date, so two wakes on one day — a
 * catch-up after an outage, then the day's real slot — cannot collide.
 */
export function mintScheduledRunId(slotMs: number): string {
  return new Date(slotMs).toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/**
 * The instant a run id names, in epoch milliseconds, or `null` for an id in
 * neither minted shape. Callers treat `null` as unrankable rather than as rank
 * zero: rank zero would lose every comparison and silently discard whatever it
 * names.
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
 * Whether `candidate` is strictly newer than `incumbent`. Ranked first, then
 * tie-broken bytewise, so the order is total and deterministic even for two
 * unrankable ids — every fold has to reach the same verdict regardless of
 * which of the two it saw first.
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
    // Exactly one side is unrankable: prefer the rankable one rather than
    // letting an unparseable id win a string compare unrelated to recency.
    return incumbentRank === null;
  }
  return candidate > incumbent;
}

/** `true` if `runId` looks like a manual request rather than a scheduled wake. */
export function isManualRun(runId: string): boolean {
  return MANUAL_RUN_ID_PATTERN.test(runId);
}
