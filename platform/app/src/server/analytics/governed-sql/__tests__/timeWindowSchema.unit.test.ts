/**
 * The coerced time window must reject inputs the coercion would otherwise
 * silently invent a date for.
 *
 * `z.coerce.date()` hands its input to the `Date` constructor, which is far
 * more permissive than the set of things a caller can legitimately mean:
 *
 *   - `new Date(null)` is the Unix epoch, so a null `start` would arrive at the
 *     service as 1970-01-01 rather than as a rejected request. Both doors spell
 *     "no window" as `undefined` (the schema is `.optional()` at each), so a
 *     null is a client error and must read as one.
 *   - An extended-year ISO string such as `+010000-01-01T00:00:00.000Z` parses,
 *     and the year then formats with five digits downstream.
 *
 * Reported by CodeRabbit (thread 3786050281) on #7014.
 */

import { describe, expect, it } from "vitest";

import { governedSqlTimeWindowSchema } from "../timeWindowSchema";

const VALID_START = "2026-07-01T00:00:00.000Z";
const VALID_END = "2026-07-02T00:00:00.000Z";

describe("governedSqlTimeWindowSchema", () => {
  it("accepts ISO strings, epoch milliseconds and Date objects alike", () => {
    expect(
      governedSqlTimeWindowSchema.safeParse({
        start: VALID_START,
        end: VALID_END,
      }).success,
    ).toBe(true);
    expect(
      governedSqlTimeWindowSchema.safeParse({
        start: Date.parse(VALID_START),
        end: new Date(VALID_END),
      }).success,
    ).toBe(true);
  });

  it("rejects null rather than coercing it to the Unix epoch", () => {
    const parsed = governedSqlTimeWindowSchema.safeParse({
      start: null,
      end: VALID_END,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a UTC year outside 0000-9999", () => {
    const parsed = governedSqlTimeWindowSchema.safeParse({
      start: "+010000-01-01T00:00:00.000Z",
      end: VALID_END,
    });

    expect(parsed.success).toBe(false);
  });
});
