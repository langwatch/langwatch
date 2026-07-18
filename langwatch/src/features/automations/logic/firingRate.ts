import {
  CADENCE_LABELS,
  CADENCE_WINDOW_MS,
  type NotificationCadence,
} from "~/shared/automations/cadences";

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

/**
 * Turn a 7-day trace-match count into a rough firing-rate phrase, accounting
 * for the automation's cadence.
 *
 * A trace automation matches once per incoming trace, but how often it actually
 * *notifies* depends on the cadence: an immediate (or persist-class) automation
 * fires once per match, whereas a digest cadence bundles every match inside its
 * window into a single notification — so the notification rate is capped at one
 * per window. `batches` is false for persist-class actions (dataset / annotation
 * writes), which always fire per match regardless of cadence.
 */
export function estimateFiringRate({
  matchesLast7Days,
  cadence,
  batches,
}: {
  matchesLast7Days: number;
  cadence: NotificationCadence;
  batches: boolean;
}): string {
  const matchesPerDay = matchesLast7Days / 7;
  const windowMs = CADENCE_WINDOW_MS[cadence];

  // Per-match: persist actions, and notify actions on the immediate cadence.
  if (!batches || windowMs === 0) {
    return `${ratePhrase(matchesPerDay)} at this rate`;
  }

  // Digest cadence: at most one notification per window that holds a match, so
  // the rate is capped at the number of windows per day.
  const windowsPerDay = (24 * 60 * 60 * 1000) / windowMs;
  const notificationsPerDay = Math.min(matchesPerDay, windowsPerDay);
  return `${ratePhrase(notificationsPerDay)}, batched ${CADENCE_LABELS[
    cadence
  ].toLowerCase()}`;
}
