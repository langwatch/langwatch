import { describe, it, expect, vi } from "vitest";
import { createStartSuiteRunCommandClass } from "../startSuiteRun.command";
import type { StartSuiteRunCommandData } from "../../schemas/commands";
import { SUITE_RUN_COMMAND_TYPES, SUITE_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { TenantId } from "../../../../domain/tenantId";

function makePayload(
  overrides: Partial<StartSuiteRunCommandData> = {},
): StartSuiteRunCommandData {
  return {
    tenantId: "project-1",
    suiteId: "suite-1",
    batchRunId: "batch-1",
    setId: "suite:suite-1",
    total: 4,
    scenarioIds: ["s1", "s2"],
    targets: [
      { id: "t1", type: "http" },
      { id: "t2", type: "prompt" },
    ],
    repeatCount: 1,
    idempotencyKey: "key-1",
    occurredAt: Date.now(),
    ...overrides,
  };
}

describe("StartSuiteRunCommand (factory)", () => {
  describe("when computing aggregate ID", () => {
    it("returns suiteId:batchRunId composite key", () => {
      const CommandClass = createStartSuiteRunCommandClass({
        scheduleSuiteRunJobs: vi.fn().mockResolvedValue(4),
      });
      const aggregateId = CommandClass.getAggregateId(makePayload());
      expect(aggregateId).toBe("suite-1:batch-1");
    });
  });

  describe("when computing job ID", () => {
    it("includes tenantId and batchRunId", () => {
      const CommandClass = createStartSuiteRunCommandClass({
        scheduleSuiteRunJobs: vi.fn().mockResolvedValue(4),
      });
      const jobId = CommandClass.makeJobId(makePayload());
      expect(jobId).toBe("project-1:batch-1:start");
    });
  });

  describe("when handling command", () => {
    it("schedules BullMQ jobs before emitting event", async () => {
      const scheduleSuiteRunJobs = vi.fn().mockResolvedValue(4);
      const CommandClass = createStartSuiteRunCommandClass({ scheduleSuiteRunJobs });
      const command = new CommandClass();
      const payload = makePayload();

      const events = await command.handle({
        type: SUITE_RUN_COMMAND_TYPES.START,
        tenantId: payload.tenantId as TenantId,
        aggregateId: CommandClass.getAggregateId(payload),
        data: payload,
      });

      expect(scheduleSuiteRunJobs).toHaveBeenCalledOnce();
      expect(scheduleSuiteRunJobs).toHaveBeenCalledWith({
        scenarioIds: ["s1", "s2"],
        targets: [
          { id: "t1", type: "http" },
          { id: "t2", type: "prompt" },
        ],
        suiteId: "suite-1",
        projectId: "project-1",
        setId: "suite:suite-1",
        batchRunId: "batch-1",
        repeatCount: 1,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(SUITE_RUN_EVENT_TYPES.STARTED);
      expect(events[0]!.data).toMatchObject({
        suiteId: "suite-1",
        batchRunId: "batch-1",
        total: 4,
        idempotencyKey: "key-1",
      });
    });

    it("propagates scheduling failures without emitting events", async () => {
      const scheduleSuiteRunJobs = vi.fn().mockRejectedValue(
        new Error("Failed to schedule: 2 of 4 jobs failed"),
      );
      const CommandClass = createStartSuiteRunCommandClass({ scheduleSuiteRunJobs });
      const command = new CommandClass();
      const payload = makePayload();

      await expect(
        command.handle({
          type: SUITE_RUN_COMMAND_TYPES.START,
          tenantId: payload.tenantId as TenantId,
          aggregateId: CommandClass.getAggregateId(payload),
          data: payload,
        }),
      ).rejects.toThrow("Failed to schedule");
    });
  });
});
