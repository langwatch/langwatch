import { scheduleTestShardHardFloor } from "./test-shard-hard-floor";

/**
 * Global setup for the UNIT test config (vitest.config.ts).
 *
 * This file exists solely to mirror the hard-floor that already lives in the
 * integration globalSetup (see
 * src/server/event-sourcing/__tests__/integration/globalSetup.ts). Unit tests
 * need no containers or other setup, so the hard-floor is the only thing here.
 *
 * The hard floor bounds CI time when a shard cannot finalize. It must fail the
 * shard so unfinished or already-failing tests cannot be reported as green.
 */
export async function setup(): Promise<void> {
  // A healthy unit shard finishes in about 3 minutes. The unref'd timer only
  // fires when the shard remains alive past the 4-minute ceiling.
  if (process.env.CI) {
    const HARD_FLOOR_MS = 4 * 60 * 1000;
    scheduleTestShardHardFloor({
      timeoutMs: HARD_FLOOR_MS,
      message: `[unit globalSetup] hard floor reached at ${HARD_FLOOR_MS / 60_000} min — failing the unfinished CI shard`,
    });
  }
}
