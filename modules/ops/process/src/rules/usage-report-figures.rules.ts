/**
 * How the usage report spells a figure on the wire (ADR-156, section 10): a counted figure under
 * its lifetime and windowed keys, a rung of getting started as its day, and the timestamp shape.
 */

import { Temporal } from "@langwatch/time";

/** One answer, taken lifetime and from each window's start (epoch ms). */
export interface Windowed<T> {
  readonly lifetime: T;
  readonly sevenDays: T;
  readonly twentyEightDays: T;
}

/** Where a lifetime total already had a name on the wire before the windows existed. */
const LIFETIME_KEYS: Readonly<Record<string, string>> = {
  traces: "totalTraces",
  scenario_runs: "totalScenarioEvents",
  batch_evaluations: "batchEvaluations",
  dataset_records: "datasetRecords",
  langy_active_users: "langy_users",
};

/** One figure under its three dictionary keys. */
export function windowed<T>(
  key: string,
  answer: Windowed<T>,
  pick: (count: T) => number,
): Record<string, number> {
  return {
    [LIFETIME_KEYS[key] ?? key]: pick(answer.lifetime),
    [`${key}_7d`]: pick(answer.sevenDays),
    [`${key}_28d`]: pick(answer.twentyEightDays),
  };
}

/** One figure under its three keys, or none where its owner left any stretch uncounted. */
export function windowedWhereCounted<T>(
  key: string,
  answer: Windowed<T>,
  pick: (count: T) => number | undefined,
): Record<string, number> {
  const lifetime = pick(answer.lifetime);
  const sevenDays = pick(answer.sevenDays);
  const twentyEightDays = pick(answer.twentyEightDays);
  if (lifetime === undefined || sevenDays === undefined || twentyEightDays === undefined) {
    return {};
  }
  return { [key]: lifetime, [`${key}_7d`]: sevenDays, [`${key}_28d`]: twentyEightDays };
}

/** The wire's timestamp shape: ISO 8601 with milliseconds, as the report has always sent. */
export function iso(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}

/** A rung of getting started: the day it was reached, or null on the wire where it never was. */
export function rung(
  key: string,
  epochMilliseconds: number | undefined,
): Record<string, string | null> {
  return { [key]: epochMilliseconds === undefined ? null : iso(epochMilliseconds) };
}
