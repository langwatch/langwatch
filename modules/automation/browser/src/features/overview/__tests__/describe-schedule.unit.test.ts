import { describe, expect, it } from "vitest";

import { describeSchedule } from "../ui/elements/automation-table-cells.tsx";

describe("describeSchedule", () => {
  it("names a daily schedule", () => {
    expect(describeSchedule("0 9 * * *", "UTC")).toBe("Daily · 09:00 UTC");
  });

  it("shows a stepped cron as the raw expression, not a garbled daily time", () => {
    expect(describeSchedule("*/15 * * * *", "Europe/Amsterdam")).toBe(
      "*/15 * * * * (Europe/Amsterdam)",
    );
  });
});
