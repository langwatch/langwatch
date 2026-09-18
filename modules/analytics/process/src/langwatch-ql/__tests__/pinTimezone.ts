/**
 * Pins the process time zone for one suite. A format reading *local* getters
 * agrees with a correct one whenever `TZ` is UTC (most CI runners), so a
 * UTC-spelling assertion is vacuous until the process is moved off it.
 */

import { afterAll, beforeAll } from "vitest";

/**
 * Moves the process to `zone` for this group, restoring it after. Call inside
 * the group's `describe`, not module scope, or it follows every other group.
 * Restores by deleting `TZ` — assigning `undefined` would store that string.
 * @param zone an IANA zone far enough from UTC that a local-getter reading disagrees.
 */
export function pinTimezone(zone: string): void {
  let original: string | undefined;

  beforeAll(() => {
    original = process.env.TZ;
    process.env.TZ = zone;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}
