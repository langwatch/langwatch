import { Temporal } from "@langwatch/time";

import { SERVING_ROSTER_PRE_ROSTER_GRACE_MS } from "../gate/serving-roster-timing.ts";
import type { UpgradePostgres } from "../ports.ts";
import { PreRosterRepository } from "../serving-roster/pre-roster.repository.ts";
import { type PreRosterHistory, preRosterWriters } from "../serving-roster/pre-roster.ts";
import type { LedgerTables } from "./reader.repository.ts";

/** Where the reader learns about writers before the roster; tests hand their own history. */
export type PreRosterHistoryReader = { findPreRosterHistory(): Promise<PreRosterHistory> };

export const preRosterHistoryOver = ({
  postgres,
}: {
  postgres: UpgradePostgres;
}): PreRosterHistoryReader => PreRosterRepository.create({ postgres });

/** When the grace for writers before the roster ends, while it holds; null once it does not. */
export async function findOldWritersGraceEnd({
  tables,
  preRoster,
}: {
  tables: LedgerTables;
  preRoster: PreRosterHistoryReader;
}): Promise<string | null> {
  if (!tables.run) return null;
  const verdict = preRosterWriters({
    history: await preRoster.findPreRosterHistory(),
    graceMs: SERVING_ROSTER_PRE_ROSTER_GRACE_MS,
  });
  return verdict.present
    ? Temporal.Instant.fromEpochMilliseconds(verdict.graceEndsAtMs).toString({
        smallestUnit: "millisecond",
      })
    : null;
}
