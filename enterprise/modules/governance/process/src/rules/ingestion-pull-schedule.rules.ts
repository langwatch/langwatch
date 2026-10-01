// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { computeNextRunAt, Temporal } from "@langwatch/time";

/** A source's next pull after `after` (epoch ms), its cron read in UTC as main's schedule did. */
export function nextIngestionPullRunAt({ cron, after }: { cron: string; after: number }): number {
  return computeNextRunAt({
    cron,
    timezone: "UTC",
    after: Temporal.Instant.fromEpochMilliseconds(after),
  }).epochMilliseconds;
}
