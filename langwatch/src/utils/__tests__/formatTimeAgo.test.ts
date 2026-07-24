import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { formatTimeAgoCompact } from "../formatTimeAgo";

describe("formatTimeAgoCompact", () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  const fixedNow = new Date("2024-01-15T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'now' for timestamps less than 1 minute ago", () => {
    expect(formatTimeAgoCompact(fixedNow - 30 * 1000)).toBe("now");
    expect(formatTimeAgoCompact(fixedNow - 59 * 1000)).toBe("now");
    expect(formatTimeAgoCompact(fixedNow)).toBe("now");
  });

  it("returns minutes for timestamps less than 1 hour ago", () => {
    expect(formatTimeAgoCompact(fixedNow - 1 * MINUTE)).toBe("1m ago");
    expect(formatTimeAgoCompact(fixedNow - 5 * MINUTE)).toBe("5m ago");
    expect(formatTimeAgoCompact(fixedNow - 30 * MINUTE)).toBe("30m ago");
    expect(formatTimeAgoCompact(fixedNow - 59 * MINUTE)).toBe("59m ago");
  });

  it("returns hours for timestamps less than 1 day ago", () => {
    expect(formatTimeAgoCompact(fixedNow - 1 * HOUR)).toBe("1h ago");
    expect(formatTimeAgoCompact(fixedNow - 5 * HOUR)).toBe("5h ago");
    expect(formatTimeAgoCompact(fixedNow - 12 * HOUR)).toBe("12h ago");
    expect(formatTimeAgoCompact(fixedNow - 23 * HOUR)).toBe("23h ago");
  });

  it("returns days for timestamps less than 1 week ago", () => {
    expect(formatTimeAgoCompact(fixedNow - 1 * DAY)).toBe("1d ago");
    expect(formatTimeAgoCompact(fixedNow - 3 * DAY)).toBe("3d ago");
    expect(formatTimeAgoCompact(fixedNow - 6 * DAY)).toBe("6d ago");
  });

  it("returns weeks for timestamps less than 30 days ago", () => {
    expect(formatTimeAgoCompact(fixedNow - 7 * DAY)).toBe("1w ago");
    expect(formatTimeAgoCompact(fixedNow - 14 * DAY)).toBe("2w ago");
    expect(formatTimeAgoCompact(fixedNow - 21 * DAY)).toBe("3w ago");
    expect(formatTimeAgoCompact(fixedNow - 28 * DAY)).toBe("4w ago");
  });

  it("returns months for timestamps 30 days or more ago", () => {
    // Note: date-fns calculates calendar differences, so 30 DAY units may
    // result in 29 calendar days depending on the date. Use 31, 62, 93 for reliable tests.
    expect(formatTimeAgoCompact(fixedNow - 31 * DAY)).toBe("1mo ago");
    expect(formatTimeAgoCompact(fixedNow - 62 * DAY)).toBe("2mo ago");
    expect(formatTimeAgoCompact(fixedNow - 93 * DAY)).toBe("3mo ago");
  });

  it("handles edge cases at time boundaries", () => {
    // Just over 1 minute
    expect(formatTimeAgoCompact(fixedNow - MINUTE - 1)).toBe("1m ago");
    // Just over 1 hour
    expect(formatTimeAgoCompact(fixedNow - HOUR - 1)).toBe("1h ago");
    // Just over 1 day
    expect(formatTimeAgoCompact(fixedNow - DAY - 1)).toBe("1d ago");
    // Just over 1 week
    expect(formatTimeAgoCompact(fixedNow - WEEK - 1)).toBe("1w ago");
  });
});
