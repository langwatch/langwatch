// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PullResult } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";

export type PullReadThrough = { outcome: "read-through"; at: number } | { outcome: "read-nowhere" };

/** One stamp as epoch ms, or none when it is malformed: never read as the epoch. */
function readableEpochMs(stamp: string): number[] {
  try {
    return [Temporal.Instant.from(stamp).epochMilliseconds];
  } catch {
    return [];
  }
}

/**
 * How far a run read (main `pullerWorker.ts` readThroughInstant): the adapter's own statement,
 * else the newest event it emitted, else now for a complete read; a truncated run that emitted
 * nothing read up to nowhere.
 */
export function pullReadThrough({
  result,
  nowMs,
}: {
  result: PullResult;
  nowMs: number;
}): PullReadThrough {
  const [stated] = result.readThroughAt === undefined ? [] : readableEpochMs(result.readThroughAt);
  if (stated !== undefined) return { outcome: "read-through", at: stated };
  const stamps = result.events.flatMap((event) => readableEpochMs(event.event_timestamp));
  if (stamps.length > 0) return { outcome: "read-through", at: Math.max(...stamps) };
  if ((result.completeness ?? "complete") === "complete") {
    return { outcome: "read-through", at: nowMs };
  }
  return { outcome: "read-nowhere" };
}
