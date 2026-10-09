import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatLangyConversationDate } from "../langy-conversation-date.ts";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");
const RealDateTimeFormat = Intl.DateTimeFormat;

describe("formatLangyConversationDate", () => {
  // The row reads in the reader's locale; the machine running the test has its own, so pin one.
  beforeEach(() => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function inEnglish(_locales, options) {
      return new RealDateTimeFormat("en-US", options);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("labels today and yesterday for fast scanning", () => {
    expect(formatLangyConversationDate(Date.parse("2026-07-16T08:00:00.000Z"), NOW)).toBe("Today");
    expect(formatLangyConversationDate(Date.parse("2026-07-15T08:00:00.000Z"), NOW)).toBe(
      "Yesterday",
    );
  });

  it("includes the year only for older conversations", () => {
    expect(formatLangyConversationDate(Date.parse("2026-07-10T08:00:00.000Z"), NOW)).toBe("Jul 10");
    expect(formatLangyConversationDate(Date.parse("2025-12-10T08:00:00.000Z"), NOW)).toBe(
      "Dec 10, 2025",
    );
  });

  it("owns missing legacy timestamps", () => {
    expect(formatLangyConversationDate(0, NOW)).toBe("Unknown date");
  });
});
