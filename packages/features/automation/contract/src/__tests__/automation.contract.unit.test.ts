import { describe, expect, it } from "vitest";
import {
  reportActionParamsSchema,
  reportScheduleSchema,
  triggerActionSchema,
  triggerKindSchema,
} from "../index";
describe("automation contract", () => {
  it("uses the deployed trigger vocabulary", () => {
    expect(triggerActionSchema.parse("SEND_EMAIL")).toBe("SEND_EMAIL");
    expect(triggerKindSchema.parse("REPORT")).toBe("REPORT");
  });

  it("validates report schedules before persistence", () => {
    expect(
      reportScheduleSchema.safeParse({
        cron: "*/5 * * * *",
        timezone: "UTC",
      }).success,
    ).toBe(false);
    expect(
      reportActionParamsSchema.parse({
        source: { kind: "dashboard", dashboardId: "dashboard" },
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
      }).compareToPrevious,
    ).toBe(false);
  });
});
