import { describe, expect, it, vi } from "vitest";
import type { Trigger } from "~/generated/prisma/client";
import { TriggerAction, TriggerKind } from "~/generated/prisma/client";
import { PublicApiTriggerService } from "../public-api-trigger.service";

const storedTrigger = (overrides: Partial<Trigger>): Trigger => ({
  id: "automation-1",
  projectId: "project-1",
  name: "Error spike",
  action: TriggerAction.SEND_EMAIL,
  triggerKind: TriggerKind.AUTOMATION,
  actionParams: { members: ["a@example.com"] },
  filters: "{}",
  filterQuery: 'status:"error"',
  deleted: false,
  active: false,
  alertType: null,
  message: null,
  customGraphId: null,
  slackTemplateType: null,
  slackTemplate: null,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  lastRunAt: 0,
  notificationCadence: "IMMEDIATE",
  traceDebounceMs: 0,
  pausedReason: "runaway_volume",
  pausedAt: new Date("2026-09-27T00:00:00Z"),
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

const makeService = (stored: Trigger) => {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...stored,
    ...data,
  }));
  const assertWritable = vi.fn(async () => undefined);
  const getFireHistoryPage = vi.fn(async () => ({
    fires: [],
    nextCursor: null,
  }));
  const triggers = {
    getById: async () => stored,
    update,
    create: vi.fn(async () => stored),
    invalidate: async () => undefined,
    syncReportSchedule: async () => undefined,
    removeReportSchedule: async () => undefined,
  };
  const service = new PublicApiTriggerService(triggers as never, {
    graphs: {} as never,
    fireHistory: { getFireHistoryPage } as never,
    filterValidation: { assertWritable },
    testFire: vi.fn() as never,
    resolveProject: vi.fn() as never,
    slackConnections: {
      connectActionParams: vi.fn(),
      findUsableSecret: vi.fn(),
    },
  });
  return { service, update, assertWritable, getFireHistoryPage };
};

describe("PublicApiTriggerService.update()", () => {
  describe("given a query-based automation with no structured conditions", () => {
    /** @scenario "Clearing the only condition over the API is refused" */
    it.each([
      null,
      "",
      "   ",
    ])("refuses filterQuery %j with trigger_filters_required", async (filterQuery) => {
      const { service, update } = makeService(storedTrigger({}));

      await expect(
        service.update({
          projectId: "project-1",
          triggerId: "automation-1",
          input: { filterQuery },
        }),
      ).rejects.toMatchObject({ code: "trigger_filters_required" });
      expect(update).not.toHaveBeenCalled();
    });

    it("accepts clearing the query when the same save states a condition", async () => {
      const { service, update } = makeService(storedTrigger({}));

      await service.update({
        projectId: "project-1",
        triggerId: "automation-1",
        input: { filterQuery: null, filters: { "spans.model": ["gpt-5"] } },
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filterQuery: null,
            filters: JSON.stringify({ "spans.model": ["gpt-5"] }),
          }),
        }),
      );
    });

    it("leaves a report's query free to clear", async () => {
      const { service, update } = makeService(
        storedTrigger({ triggerKind: TriggerKind.REPORT }),
      );

      await service.update({
        projectId: "project-1",
        triggerId: "automation-1",
        input: { filterQuery: null },
      });

      expect(update).toHaveBeenCalled();
    });
  });

  describe("when the save states structured conditions", () => {
    /** @scenario "A keyed condition written without its key is refused" */
    it("holds them to the write-time filter check", async () => {
      const { service, assertWritable } = makeService(storedTrigger({}));
      assertWritable.mockRejectedValueOnce(new Error("refused"));

      await expect(
        service.update({
          projectId: "project-1",
          triggerId: "automation-1",
          input: { filters: { "evaluations.passed": ["false"] } },
        }),
      ).rejects.toThrow("refused");
      expect(assertWritable).toHaveBeenCalledWith({
        projectId: "project-1",
        filters: { "evaluations.passed": ["false"] },
      });
    });
  });

  describe("when a paused automation is resumed with active: true", () => {
    /** @scenario "Resuming over the API clears the pause record" */
    it("clears pausedReason and pausedAt", async () => {
      const { service, update } = makeService(storedTrigger({}));

      await service.update({
        projectId: "project-1",
        triggerId: "automation-1",
        input: { active: true },
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            active: true,
            pausedReason: null,
            pausedAt: null,
          }),
        }),
      );
    });

    it("keeps the pause record when pausing", async () => {
      const { service, update } = makeService(storedTrigger({}));

      await service.update({
        projectId: "project-1",
        triggerId: "automation-1",
        input: { active: false },
      });

      const data = update.mock.calls[0]?.[0].data;
      expect(data).not.toHaveProperty("pausedReason");
    });
  });
});

describe("PublicApiTriggerService.create()", () => {
  /** @scenario "A keyed condition written without its key is refused" */
  it("holds a trace automation's conditions to the write-time filter check", async () => {
    const { service, assertWritable } = makeService(storedTrigger({}));
    assertWritable.mockRejectedValueOnce(new Error("refused"));

    await expect(
      service.create({
        projectId: "project-1",
        input: {
          name: "Failed checks",
          action: TriggerAction.SEND_EMAIL,
          actionParams: { members: ["a@example.com"] },
          filters: { "metadata.value": ["true"] },
        },
      }),
    ).rejects.toThrow("refused");
  });
});

describe("PublicApiTriggerService.getFireHistory()", () => {
  /** @scenario "Fire history pages over the API" */
  it("reads the page after the cursor", async () => {
    const { service, getFireHistoryPage } = makeService(storedTrigger({}));
    const cursor = { createdAt: new Date("2026-09-28T00:00:00Z"), id: "ts_9" };

    await service.getFireHistory({
      projectId: "project-1",
      triggerId: "automation-1",
      limit: 20,
      cursor,
    });

    expect(getFireHistoryPage).toHaveBeenCalledWith({
      projectId: "project-1",
      triggerId: "automation-1",
      limit: 20,
      cursor,
    });
  });
});
