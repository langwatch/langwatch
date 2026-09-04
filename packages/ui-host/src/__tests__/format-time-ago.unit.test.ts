import { describe, expect, it } from "vitest";

import { formatTimeAgo, formatTimeAgoCompact } from "../format-time-ago";

describe("formatTimeAgo", () => {
  describe("given a timestamp inside the relative window", () => {
    it("says how long ago it was", () => {
      expect(formatTimeAgo(Date.now() - 1000 * 60 * 12)).toBe("12 minutes ago");
    });
  });

  describe("given a timestamp older than the window", () => {
    it("prints the absolute stamp instead", () => {
      const at = new Date("2024-03-05T09:30:00Z").getTime();
      expect(formatTimeAgo(at)).toMatch(/^05\/Mar \d{2}:\d{2}$/);
    });

    it("honours a caller's own window and format", () => {
      const at = Date.now() - 1000 * 60 * 60 * 6;
      expect(formatTimeAgo(at, "yyyy-MM-dd", 5)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("given a falsy timestamp", () => {
    it("answers nothing rather than an epoch date", () => {
      expect(formatTimeAgo(0)).toBeUndefined();
    });
  });
});

describe("formatTimeAgoCompact", () => {
  const now = new Date("2024-06-01T12:00:00Z").getTime();
  const ago = (ms: number) => formatTimeAgoCompact(now - ms, now);

  it("reads as now inside the first minute", () => {
    expect(ago(30_000)).toBe("now");
  });

  it("climbs the ladder from minutes to months", () => {
    expect(ago(1000 * 60 * 5)).toBe("5m ago");
    expect(ago(1000 * 60 * 60 * 3)).toBe("3h ago");
    expect(ago(1000 * 60 * 60 * 24 * 2)).toBe("2d ago");
    expect(ago(1000 * 60 * 60 * 24 * 10)).toBe("1w ago");
    expect(ago(1000 * 60 * 60 * 24 * 90)).toBe("3mo ago");
  });

  it("reads the browser's own clock when the caller names none", () => {
    expect(formatTimeAgoCompact(Date.now() - 1000 * 60 * 90)).toBe("1h ago");
  });
});
