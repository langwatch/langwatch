// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DateFormats, FormattedDate } from "../src/components/values/formatted-date.tsx";
import { formatInstant, relativeRefreshMs } from "../src/describe-instant.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

const AT = Date.UTC(2026, 9, 8, 14, 32);
const fmt = (display: Parameters<typeof formatInstant>[0]["display"], nowMs = AT) =>
  formatInstant({ epochMs: AT, display, nowMs, locale: "en-US", timeZone: "UTC" });

describe("formatInstant", () => {
  describe("given each display", () => {
    /** @scenario "A date reads as the display asks" */
    it("reads as a date, a time, both or an age", () => {
      expect(fmt("datetime")).toBe("Oct 8, 2026, 2:32 PM");
      expect(fmt("date")).toBe("Oct 8, 2026");
      expect(fmt("time")).toBe("2:32 PM");
      expect(fmt("relative", AT + 3 * 60_000)).toBe("3 minutes ago");
    });
  });

  describe("given auto", () => {
    it("shows the time today, the day this year and the date before that", () => {
      expect(fmt("auto", AT + 60_000)).toBe("2:32 PM");
      expect(fmt("auto", AT + 40 * 86_400_000)).toBe("Oct 8, 2:32 PM");
      expect(fmt("auto", AT + 400 * 86_400_000)).toBe("Oct 8, 2026");
    });
  });

  describe("given showZone", () => {
    it("names the zone", () => {
      expect(
        formatInstant({
          epochMs: AT,
          display: "time",
          locale: "en-US",
          timeZone: "UTC",
          showZone: true,
        }),
      ).toBe("2:32 PM UTC");
    });
  });
});

describe("relativeRefreshMs", () => {
  it("ticks every second while fresh and slows as the value ages", () => {
    expect(relativeRefreshMs({ epochMs: AT, nowMs: AT + 5_000 })).toBe(1_000);
    expect(relativeRefreshMs({ epochMs: AT, nowMs: AT + 600_000 })).toBe(30_000);
    expect(relativeRefreshMs({ epochMs: AT, nowMs: AT + 86_400_000 })).toBe(1_800_000);
  });
});

describe("FormattedDate", () => {
  describe("given an ISO string", () => {
    it("renders a time element carrying the instant", () => {
      const { container } = renderWithDesignSystem(<FormattedDate value="2026-10-08T14:32:00Z" />);

      expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
        "2026-10-08T14:32:00Z",
      );
    });
  });

  describe("given an unreadable value", () => {
    it("draws a dash", () => {
      renderWithDesignSystem(<FormattedDate value="not a date" />);
      expect(screen.getByText("—")).toBeTruthy();
    });
  });
});

describe("DateFormats", () => {
  /** @scenario "The date hover copies every form on click" */
  it("offers every form as a copy button", () => {
    renderWithDesignSystem(<DateFormats epochMs={AT} />);

    expect(
      screen.getByRole("button", { name: /^Copy ISO 8601: 2026-10-08T14:32:00Z$/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: `Copy Unix ms: ${AT}` })).toBeTruthy();
  });
});
