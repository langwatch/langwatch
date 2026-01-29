import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { formatTimeAgo } from "../formatTimeAgo";

describe("formatTimeAgo", () => {
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
    expect(formatTimeAgo(fixedNow - 30 * 1000)).toBe("now");
    expect(formatTimeAgo(fixedNow - 59 * 1000)).toBe("now");
    expect(formatTimeAgo(fixedNow)).toBe("now");
  });

  it("returns minutes for timestamps less than 1 hour ago", () => {
    expect(formatTimeAgo(fixedNow - 1 * MINUTE)).toBe("1m ago");
    expect(formatTimeAgo(fixedNow - 5 * MINUTE)).toBe("5m ago");
    expect(formatTimeAgo(fixedNow - 30 * MINUTE)).toBe("30m ago");
    expect(formatTimeAgo(fixedNow - 59 * MINUTE)).toBe("59m ago");
  });

  it("returns hours for timestamps less than 1 day ago", () => {
    expect(formatTimeAgo(fixedNow - 1 * HOUR)).toBe("1h ago");
    expect(formatTimeAgo(fixedNow - 5 * HOUR)).toBe("5h ago");
    expect(formatTimeAgo(fixedNow - 12 * HOUR)).toBe("12h ago");
    expect(formatTimeAgo(fixedNow - 23 * HOUR)).toBe("23h ago");
  });

  it("returns days for timestamps less than 1 week ago", () => {
    expect(formatTimeAgo(fixedNow - 1 * DAY)).toBe("1d ago");
    expect(formatTimeAgo(fixedNow - 3 * DAY)).toBe("3d ago");
    expect(formatTimeAgo(fixedNow - 6 * DAY)).toBe("6d ago");
  });

  it("returns weeks for timestamps less than 30 days ago", () => {
    expect(formatTimeAgo(fixedNow - 7 * DAY)).toBe("1w ago");
    expect(formatTimeAgo(fixedNow - 14 * DAY)).toBe("2w ago");
    expect(formatTimeAgo(fixedNow - 21 * DAY)).toBe("3w ago");
    expect(formatTimeAgo(fixedNow - 28 * DAY)).toBe("4w ago");
  });

  it("returns months for timestamps 30 days or more ago", () => {
    expect(formatTimeAgo(fixedNow - 30 * DAY)).toBe("1mo ago");
    expect(formatTimeAgo(fixedNow - 60 * DAY)).toBe("2mo ago");
    expect(formatTimeAgo(fixedNow - 90 * DAY)).toBe("3mo ago");
  });

  it("handles edge cases at time boundaries", () => {
    // Just over 1 minute
    expect(formatTimeAgo(fixedNow - MINUTE - 1)).toBe("1m ago");
    // Just over 1 hour
    expect(formatTimeAgo(fixedNow - HOUR - 1)).toBe("1h ago");
    // Just over 1 day
    expect(formatTimeAgo(fixedNow - DAY - 1)).toBe("1d ago");
    // Just over 1 week
    expect(formatTimeAgo(fixedNow - WEEK - 1)).toBe("1w ago");
  });
});
