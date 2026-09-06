/**
 * Pinning the process time zone for the length of one suite.
 *
 * A format that reads the *local* getters agrees with a correct one on every
 * instant wherever `TZ` is UTC — which is most CI runners — so a group asserting
 * a UTC spelling is vacuous until the process is moved off it. Call this at the
 * top of the group whose assertions depend on the difference.
 */

import { afterAll, beforeAll } from "vitest";

/**
 * Move the process to `zone` for this group, and put it back afterwards.
 *
 * Registers a `beforeAll`/`afterAll` pair, so it belongs at the top of the
 * `describe` it applies to rather than at module scope — a zone pinned for the
 * whole file would follow every other group in it.
 *
 * Restores by *deleting* rather than by assigning the captured value back:
 * `process.env.TZ = undefined` stores the string `"undefined"`, which is not the
 * unset the suite started from and is not a zone any later group can rely on.
 *
 * @param zone an IANA name far enough from UTC that a local-getter reading
 *   disagrees — `America/Sao_Paulo` is UTC-3, so the hour and, near midnight,
 *   the calendar day both differ.
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
