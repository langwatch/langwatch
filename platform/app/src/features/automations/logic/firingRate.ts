import {
  CADENCE_LABELS,
  CADENCE_WINDOW_MS,
  type NotificationCadence,
} from "@langwatch/automations/cadences";

/** "About N times a {unit}", picking the coarsest unit that reads naturally. */
function ratePhrase(perDay: number): string {
  if (perDay >= 24) {
    const n = Math.round(perDay / 24);
    return `About ${n} ${n === 1 ? "time" : "times"} an hour`;
  }
  if (perDay >= 1) {
    const n = Math.round(perDay);
    return `About ${n} ${n === 1 ? "time" : "times"} a day`;
  }
  const n = Math.max(1, Math.round(perDay * 7));
  return `About ${n} ${n === 1 ? "time" : "times"} a week`;
}

export interface FiringRateInput {
  matchesLast7Days: number;
  cadence: NotificationCadence;
  canBatch: boolean;
}

/** Whether the cadence actually bundles matches for this action. */
function bundlesMatches({ cadence, canBatch }: FiringRateInput): boolean {
  return canBatch && CADENCE_WINDOW_MS[cadence] > 0;
}

/**
 * How many times a day the automation acts, as a raw number.
 *
 * A trace automation matches once per incoming trace, but how often it actually
 * *notifies* depends on the cadence: an immediate (or persist-class) automation
 * fires once per match, whereas a digest cadence bundles every match inside its
 * window into a single notification — so the notification rate is capped at one
 * per window. `canBatch` is false for persist-class actions (dataset / annotation
 * writes), which always fire per match regardless of cadence, which is why for
 * those this is also the matches-per-day estimate the daily ceiling counts.
 */
export function estimateRatePerDay(input: FiringRateInput): number {
  const matchesPerDay = input.matchesLast7Days / 7;
  if (!bundlesMatches(input)) return matchesPerDay;

  // Digest cadence: at most one notification per window that holds a match, so
  // the rate is capped at the number of windows per day.
  const windowsPerDay =
    (24 * 60 * 60 * 1000) / CADENCE_WINDOW_MS[input.cadence];
  return Math.min(matchesPerDay, windowsPerDay);
}

/**
 * Turn a 7-day trace-match count into a rough firing-rate phrase, accounting
 * for the automation's cadence.
 */
export function estimateFiringRate(input: FiringRateInput): string {
  const phrase = ratePhrase(estimateRatePerDay(input));
  return bundlesMatches(input)
    ? `${phrase}, batched ${CADENCE_LABELS[input.cadence].toLowerCase()}`
    : `${phrase} at this rate`;
}
