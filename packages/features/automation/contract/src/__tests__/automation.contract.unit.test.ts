import { describe, expect, it } from "vitest";
import {
  reportActionParamsSchema,
  reportScheduleSchema,
  triggerActionSchema,
  triggerKindSchema,
  updateTriggerCommandSchema,
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

  it("lets an edit change what the automation is, and still refuses a stray key", () => {
    // The drawer converts between kinds on save — a trace automation becomes a
    // report, a graph alert releases its graph — so all three of these travel
    // on an edit. A schema that rejected them turned every re-save into an
    // `unrecognized_keys` throw with no handled shape.
    const converted = updateTriggerCommandSchema.safeParse({
      id: "trigger_1",
      projectId: "project_1",
      action: "SEND_EMAIL",
      triggerKind: "REPORT",
      customGraphId: null,
    });
    expect(converted.success).toBe(true);
    expect(
      updateTriggerCommandSchema.safeParse({
        id: "trigger_1",
        projectId: "project_1",
        somethingElse: true,
      }).success,
    ).toBe(false);
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
