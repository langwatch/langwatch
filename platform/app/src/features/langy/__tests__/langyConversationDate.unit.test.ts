import { describe, expect, it } from "vitest";
import { formatLangyConversationDate } from "../logic/langyConversationDate";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

describe("formatLangyConversationDate", () => {
  it("labels today and yesterday for fast scanning", () => {
    expect(
      formatLangyConversationDate(Date.parse("2026-07-16T08:00:00.000Z"), NOW),
    ).toBe("Today");
    expect(
      formatLangyConversationDate(Date.parse("2026-07-15T08:00:00.000Z"), NOW),
    ).toBe("Yesterday");
  });

  it("includes the year only for older conversations", () => {
    expect(
      formatLangyConversationDate(Date.parse("2026-07-10T08:00:00.000Z"), NOW),
    ).toMatch(/Jul 10/);
    expect(
      formatLangyConversationDate(Date.parse("2025-12-10T08:00:00.000Z"), NOW),
    ).toMatch(/2025/);
  });

  it("owns missing legacy timestamps", () => {
    expect(formatLangyConversationDate(0, NOW)).toBe("Unknown date");
  });
});
