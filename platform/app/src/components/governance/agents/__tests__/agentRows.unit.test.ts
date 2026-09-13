/**
 * The two elapsed-time formatters behind the agents list.
 *
 * Both are exercised incidentally by the list and card integration tests, but
 * only at the values the sample rows happen to hold. `registeredDaysAgo` tops
 * out at 320 across every sample, which never reaches the years branch, and no
 * sample registered today or exactly one day ago. Those are the values where a
 * boundary is either right or off by one, so they are pinned here rather than
 * left to whichever numbers the fixtures carry.
 *
 * The rule these enforce is the page-wide one: a value the platform does not
 * have reads as a dash, and a value it does have never reads as a zero.
 */
import { describe, expect, it } from "vitest";

import { formatLastActive, formatRegistered } from "../agentRows";

describe("formatRegistered", () => {
  it("gives back nothing when the platform has no registration date", () => {
    // The caller draws the dash. Returning a phrase here would put words in a
    // cell that has no fact behind it.
    expect(formatRegistered(null)).toBeNull();
  });

  it("says today rather than counting zero days", () => {
    expect(formatRegistered(0)).toBe("today");
  });

  it("counts single days in the singular", () => {
    expect(formatRegistered(1)).toBe("1 day ago");
  });

  it("counts days up to the last day before a month", () => {
    expect(formatRegistered(29)).toBe("29 days ago");
  });

  it("turns thirty days into one month, in the singular", () => {
    expect(formatRegistered(30)).toBe("1 month ago");
  });

  it("keeps counting months to the last month before a year", () => {
    // 11 months, and the highest value any sample row carries is inside this
    // branch, which is why the branches past it need their own cases.
    expect(formatRegistered(320)).toBe("10 months ago");
    expect(formatRegistered(359)).toBe("11 months ago");
  });

  it("never reads as zero years in the gap between the two units", () => {
    // The regression this file exists for. Months are thirty days; counting
    // years as 365 days instead left days 360 through 364 flooring to zero,
    // so the reader was told an agent registered "0 years ago".
    for (const daysAgo of [360, 361, 362, 363, 364]) {
      expect(formatRegistered(daysAgo)).toBe("1 year ago");
    }
  });

  it("counts years in the singular and the plural", () => {
    expect(formatRegistered(365)).toBe("1 year ago");
    expect(formatRegistered(720)).toBe("2 years ago");
  });

  it("never returns a zero quantity at any day inside four years", () => {
    // Rather than trusting the branch cases to cover every crossing, walk the
    // whole range a real agent could plausibly sit in and assert the shape.
    for (let daysAgo = 0; daysAgo <= 1460; daysAgo++) {
      const phrase = formatRegistered(daysAgo);
      expect(phrase).not.toBeNull();
      expect(phrase).not.toMatch(/\b0 /);
    }
  });
});

describe("formatLastActive", () => {
  it("gives back nothing when the agent has never run", () => {
    expect(formatLastActive(null)).toBeNull();
  });

  it("says just now rather than counting zero minutes", () => {
    expect(formatLastActive(0)).toBe("just now");
  });

  it("climbs from minutes to hours to days, singular at each step", () => {
    expect(formatLastActive(1)).toBe("1 minute ago");
    expect(formatLastActive(59)).toBe("59 minutes ago");
    expect(formatLastActive(60)).toBe("1 hour ago");
    expect(formatLastActive(23 * 60)).toBe("23 hours ago");
    expect(formatLastActive(24 * 60)).toBe("1 day ago");
    expect(formatLastActive(48 * 60)).toBe("2 days ago");
  });

  it("never returns a zero quantity at any minute inside a week", () => {
    for (let minutesAgo = 0; minutesAgo <= 7 * 24 * 60; minutesAgo++) {
      const phrase = formatLastActive(minutesAgo);
      expect(phrase).not.toBeNull();
      expect(phrase).not.toMatch(/\b0 /);
    }
  });
});
