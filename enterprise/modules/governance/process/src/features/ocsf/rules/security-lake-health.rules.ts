// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  securityLakeHealthSchema,
  type SecurityLakeHealth,
} from "@langwatch/enterprise-governance-contract";

/** The reader's tally of one run, as the health folds it. */
export type SecurityLakeRunTally = {
  messages: number;
  objects: number;
  rows: number;
  written: number;
  dropped: number;
  invalid: number;
  retried: number;
  poison: { messageId: string; key: string; reason: string }[];
  oldestEventTimeMs: number | undefined;
};

const POISON_KEPT = 20;

export function emptySecurityLakeHealth(): SecurityLakeHealth {
  return {
    lastReadAt: null,
    lagMs: null,
    runs: 0,
    messages: 0,
    objects: 0,
    rows: 0,
    written: 0,
    dropped: 0,
    invalid: 0,
    retried: 0,
    poisonCount: 0,
    poison: [],
  };
}

/** The health a source's cursor holds; a missing or foreign cursor starts from zero. */
export function parseSecurityLakeHealth(cursor: string | null | undefined): SecurityLakeHealth {
  if (!cursor) return emptySecurityLakeHealth();
  try {
    const parsed = securityLakeHealthSchema.safeParse(JSON.parse(cursor));
    return parsed.success ? parsed.data : emptySecurityLakeHealth();
  } catch {
    return emptySecurityLakeHealth();
  }
}

/** Adds the rows one message wrote to the run's tally, keeping the oldest event time for the lag. */
export function tallyWrittenRows({
  tally,
  written,
}: {
  tally: SecurityLakeRunTally;
  written: {
    objects: number;
    decoded: number;
    dropped: number;
    invalid: number;
    rows: readonly { eventTime: { epochMilliseconds: number } }[];
  };
}): void {
  tally.objects += written.objects;
  tally.rows += written.decoded;
  tally.written += written.rows.length;
  tally.dropped += written.dropped;
  tally.invalid += written.invalid;
  for (const row of written.rows) {
    const at = row.eventTime.epochMilliseconds;
    if (tally.oldestEventTimeMs === undefined || at < tally.oldestEventTimeMs) {
      tally.oldestEventTimeMs = at;
    }
  }
}

/** Adds one run to the health: counts sum, lag is the last run's, poison keeps the newest. */
export function foldSecurityLakeRun({
  previous,
  run,
  nowMs,
}: {
  previous: SecurityLakeHealth;
  run: SecurityLakeRunTally;
  nowMs: number;
}): SecurityLakeHealth {
  const poison = [
    ...previous.poison,
    ...run.poison.map((entry) => ({ ...entry, at: nowMs })),
  ].slice(-POISON_KEPT);
  return {
    lastReadAt: nowMs,
    lagMs: run.oldestEventTimeMs === undefined ? null : Math.max(0, nowMs - run.oldestEventTimeMs),
    runs: previous.runs + 1,
    messages: previous.messages + run.messages,
    objects: previous.objects + run.objects,
    rows: previous.rows + run.rows,
    written: previous.written + run.written,
    dropped: previous.dropped + run.dropped,
    invalid: previous.invalid + run.invalid,
    retried: previous.retried + run.retried,
    poisonCount: previous.poisonCount + run.poison.length,
    poison,
  };
}
