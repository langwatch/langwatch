import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  createPublicApiRig,
  triggerRow,
} from "../../transport/__tests__/automation-rest-redaction.fixture.ts";

const queryOnly = triggerRow({
  id: "trigger_query",
  action: TriggerAction.SEND_EMAIL,
  actionParams: { members: ["a@example.com"] },
  filters: {},
  filterQuery: 'status:"error"',
  active: false,
  pausedReason: "runaway_volume",
  pausedAt: new Date("2026-09-27T00:00:00Z"),
});

const update = (
  rig: ReturnType<typeof createPublicApiRig>,
  input: Parameters<typeof rig.service.update>[0]["input"],
) =>
  rig.service.update({
    projectId: "project_1",
    triggerId: "trigger_query",
    actorId: "user_1",
    input,
  });

describe("AutomationPublicApiService.update()", () => {
  describe("given a query-based automation with no structured conditions", () => {
    /** @scenario "Clearing the only condition over the API is refused" */
    it.each([{ filterQuery: null }, { filterQuery: "   " }])(
      "refuses clearing the query (%o)",
      async (input) => {
        await expect(
          update(createPublicApiRig({ rows: [queryOnly] }), input),
        ).rejects.toMatchObject({
          code: "trigger_filters_required",
        });
      },
    );

    it("accepts clearing the query when the same save states a condition", async () => {
      const rig = createPublicApiRig({ rows: [queryOnly] });
      const saved = await update(rig, { filterQuery: null, filters: { "traces.error": ["true"] } });
      expect(saved.filterQuery).toBeNull();
      expect(saved.filters).toEqual({ "traces.error": ["true"] });
    });

    it("leaves a report's query free to clear", async () => {
      const rig = createPublicApiRig({ rows: [{ ...queryOnly, triggerKind: "REPORT" }] });
      await expect(update(rig, { filterQuery: null })).resolves.toMatchObject({
        filterQuery: null,
      });
    });
  });

  describe("when the save states structured conditions", () => {
    it("holds them to the write-time filter check", async () => {
      await expect(
        update(createPublicApiRig({ rows: [queryOnly] }), {
          filters: { "evaluations.passed": ["false"] },
        }),
      ).rejects.toMatchObject({ code: "trigger_filter_key_required" });
    });
  });

  describe("when a paused automation is resumed with active: true", () => {
    /** @scenario "Resuming over the API clears the pause record" */
    it("clears pausedReason and pausedAt", async () => {
      const saved = await update(createPublicApiRig({ rows: [queryOnly] }), { active: true });
      expect(saved).toMatchObject({ active: true, pausedReason: null, pausedAt: null });
    });

    it("keeps the pause record when pausing", async () => {
      const saved = await update(createPublicApiRig({ rows: [queryOnly] }), { active: false });
      expect(saved.pausedReason).toBe("runaway_volume");
    });
  });

  describe("when a report whose settings no longer parse is resumed", () => {
    it("resumes it and retires its calendar entry, as main does", async () => {
      const rig = createPublicApiRig({ rows: [{ ...queryOnly, triggerKind: "REPORT" }] });
      const saved = await rig.service.setActive({
        projectId: "project_1",
        triggerId: "trigger_query",
        active: true,
      });
      expect(saved.active).toBe(true);
      expect(rig.removeReportSchedule).toHaveBeenCalled();
    });
  });
});

describe("AutomationPublicApiService.create()", () => {
  it("holds a trace automation's conditions to the write-time filter check", async () => {
    const rig = createPublicApiRig({ evaluatorIds: ["evaluator_1"] });
    await expect(
      rig.service.create({
        projectId: "project_1",
        actorId: "user_1",
        input: {
          name: "Failing judge",
          action: "SEND_EMAIL",
          actionParams: { members: ["a@example.com"] },
          filters: { "evaluations.passed": { evaluator_1: ["false"] } },
        },
      }),
    ).rejects.toMatchObject({ code: "trigger_filter_monitor_required" });
  });

  /** @scenario "A new notification automation starts on the cadence that protects against storms" */
  it("starts a notification on the five-minute digest", async () => {
    const rig = createPublicApiRig();
    const created = await rig.service.create({
      projectId: "project_1",
      actorId: "user_1",
      input: {
        name: "Errors",
        action: "SEND_EMAIL",
        actionParams: { members: ["a@example.com"] },
        filters: { "traces.error": ["true"] },
      },
    });
    expect(rig.rows.get(created.id)?.filters).toEqual({ "traces.error": ["true"] });
  });

  /** @scenario "An automation whose only conditions are unsupported is refused" */
  it("refuses conditions naming only fields this platform no longer filters on", async () => {
    await expect(
      createPublicApiRig().service.create({
        projectId: "project_1",
        actorId: "user_1",
        input: {
          name: "Old",
          action: "SEND_EMAIL",
          actionParams: { members: ["a@example.com"] },
          filters: { "legacy.field": ["x"] },
        },
      }),
    ).rejects.toMatchObject({ code: "trigger_filters_unsupported" });
  });
});

describe("AutomationPublicApiService.getFireHistory()", () => {
  /** @scenario "An automation in another project reads as one that does not exist" */
  it("reads another project's automation as not found", async () => {
    const rig = createPublicApiRig({ rows: [{ ...queryOnly, projectId: "project_2" }] });
    await expect(
      rig.service.getFireHistory({
        projectId: "project_1",
        triggerId: "trigger_query",
        limit: 20,
        cursor: null,
      }),
    ).rejects.toMatchObject({ code: "trigger_not_found" });
  });

  it("reads the page after the cursor", async () => {
    const rig = createPublicApiRig({ rows: [queryOnly] });
    for (const [id, at] of [
      ["fire_a", "2026-09-01T00:00:00Z"],
      ["fire_b", "2026-09-02T00:00:00Z"],
    ] as const) {
      rig.store.fires.push({
        id,
        projectId: "project_1",
        triggerId: "trigger_query",
        customGraphId: null,
        createdAt: new Date(at),
        resolvedAt: null,
      });
    }
    const page = await rig.service.getFireHistory({
      projectId: "project_1",
      triggerId: "trigger_query",
      limit: 20,
      cursor: { createdAt: new Date("2026-09-02T00:00:00Z"), id: "fire_b" },
    });
    expect(page.fires.map((fire) => fire.id)).toEqual(["fire_a"]);
    expect(page.nextCursor).toBeNull();
  });
});
