/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { CronSchedule, describeCronField, describeCronSchedule } from "../cron-schedule.tsx";

afterEach(cleanup);

describe("Feature: A cron schedule reads as a sentence with its expression beside it", () => {
  it("Scenario: Common schedules read as sentences", () => {
    expect(describeCronSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCronSchedule("0 9 * * 1")).toBe("Every Monday at 09:00");
    expect(describeCronSchedule("30 8 * * 1-5")).toBe("Weekdays at 08:30");
    expect(describeCronSchedule("0 6 1 * *")).toBe("On the 1st of every month at 06:00");
    expect(describeCronSchedule("0 */2 * * *")).toBe("Every 2 hours");
  });

  it("Scenario: A schedule it cannot say reads as custom", () => {
    expect(describeCronSchedule("0 9 1-7 1,7 *")).toBeNull();
    renderWithDesignSystem(<CronSchedule cron="0 9 1-7 1,7 *" timezone="UTC" />);
    expect(screen.getByText("Custom schedule")).toBeInTheDocument();
    expect(screen.getByText("1,7")).toBeInTheDocument();
  });

  it("Scenario: Each field of the expression names itself", () => {
    renderWithDesignSystem(<CronSchedule cron="*/15 * * * *" timezone="Europe/Amsterdam" />);
    const labels = [...document.querySelectorAll("[data-cron-field]")].map((el) =>
      el.getAttribute("data-cron-field"),
    );
    expect(labels).toEqual(["Minute", "Hour", "Day of month", "Month", "Day of week"]);
    expect(describeCronField({ index: 0, value: "*/15" })).toBe("every 15 minutes");
    expect(describeCronField({ index: 4, value: "1-5" })).toBe("Monday to Friday");
    expect(screen.getByText("Every 15 minutes")).toBeInTheDocument();
    expect(screen.getByText("Amsterdam")).toBeInTheDocument();
  });
});
