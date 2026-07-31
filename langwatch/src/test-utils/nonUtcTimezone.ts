import { beforeEach, expect } from "vitest";

/**
 * Kolkata is deliberate: its +05:30 offset also catches a parse that happens to
 * align on whole hours, which a zone like Etc/GMT-5 would let through.
 */
const DEFAULT_ZONE = "Asia/Kolkata";

/**
 * Pin the process to a non-UTC zone for a DateTime64-decode suite.
 *
 * ClickHouse emits DateTime64(3) without a zone suffix
 * ("2026-07-24 12:00:00.123") and V8 reads a bare datetime as LOCAL time, so
 * `new Date(str)` silently skews every timestamp by the host's UTC offset. CI
 * runs in UTC, where the broken and the correct parse agree — the assertion
 * only has teeth in a non-UTC zone, which is why each of these suites carries a
 * module-scope `process.env.TZ` assignment.
 *
 * Module scope alone is not enough. The unit pool runs `isolate: false`
 * (vitest.config.ts), so one process and one reused VM context carry every file
 * a worker picks up. The module-scope assignment lands once, when the file is
 * first evaluated, and whatever a neighbouring file does to `process.env`
 * afterwards outlives it — which is how one of these three suites, and only
 * one, came back as "expected +0 not to be +0" on a CI shard while its
 * identical siblings passed.
 *
 * Re-applying immediately before each test removes the dependency on file
 * order. V8 re-reads the zone on the next `Date` construction, so a late
 * assignment is worth exactly as much as an early one — verified on both linux
 * and darwin, including inside an already-warm vm context.
 *
 * The guard stays: if the zone will not take, these suites are asserting
 * nothing, and that should be loud rather than green.
 */
export function useNonUtcTimezone(zone: string = DEFAULT_ZONE): void {
  process.env.TZ = zone;

  beforeEach(() => {
    process.env.TZ = zone;

    expect(
      new Date().getTimezoneOffset(),
      `TZ=${zone} did not take hold, so a bare DateTime64 string parses the ` +
        `same whether or not the decoder anchors it to UTC and this suite ` +
        `proves nothing. Check the pool in vitest.config.ts still gives each ` +
        `worker its own process.`,
    ).not.toBe(0);
  });
}
