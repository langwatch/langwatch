import { describe, expect, it } from "vitest";
import {
  reportActionParamsSchema,
  reportScheduleSchema,
  triggerActionSchema,
  triggerKindSchema,
} from "../index";
describe("automation contract", () => {
  it("uses the deployed trigger vocabulary", () => {
    // A deployed member is accepted and an undeployed one is refused. Echoing
    // the member back said nothing about the vocabulary's edges.
    expect(triggerActionSchema.safeParse("SEND_EMAIL").success).toBe(true);
    expect(triggerActionSchema.safeParse("SEND_CARRIER_PIGEON").success).toBe(false);
    expect(triggerKindSchema.safeParse("REPORT").success).toBe(true);
    expect(triggerKindSchema.safeParse("NOT_A_KIND").success).toBe(false);
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
