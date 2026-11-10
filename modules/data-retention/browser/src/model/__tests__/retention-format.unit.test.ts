import { describe, expect, it } from "vitest";

import { formatDays } from "../retention-format.ts";

describe("formatDays", () => {
  /** @scenario "A stored preset reads as the option that was picked" */
  it("shows a preset's label for its stored value", () => {
    expect(formatDays(371)).toBe("1 year");
    expect(formatDays(91)).toBe("90 days");
    expect(formatDays(1827)).toBe("5 years");
  });

  it("shows other values in days", () => {
    expect(formatDays(49)).toBe("49 days");
    expect(formatDays(0)).toBe("Indefinite");
  });
});
