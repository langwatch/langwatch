import { describe, it, expect } from "vitest";
import { StartScenarioCommand } from "../startScenario.command";
import type { StartScenarioCommandData } from "../../schemas/commands";
import { SUITE_RUN_COMMAND_TYPES, SUITE_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { TenantId } from "../../../../domain/tenantId";

function makePayload(
  overrides: Partial<StartScenarioCommandData> = {},
): StartScenarioCommandData {
  return {
    tenantId: "project-1",
    suiteId: "suite-1",
    batchRunId: "batch-1",
    scenarioRunId: "sr-1",
    scenarioId: "s1",
    targetReferenceId: "t1",
    targetType: "http",
    occurredAt: Date.now(),
    ...overrides,
  };
}

describe("StartScenarioCommand", () => {
  describe("when computing aggregate ID", () => {
    it("returns suiteId:batchRunId composite key", () => {
      const aggregateId = StartScenarioCommand.getAggregateId(makePayload());
      expect(aggregateId).toBe("suite-1:batch-1");
    });
  });

  describe("when computing job ID", () => {
    it("includes tenantId, batchRunId, and scenarioRunId", () => {
      const jobId = StartScenarioCommand.makeJobId(makePayload());
      expect(jobId).toBe("project-1:batch-1:sr-1:started");
    });
  });

  describe("when handling command", () => {
    it("emits SuiteRunScenarioStartedEvent", async () => {
      const command = new StartScenarioCommand();
      const payload = makePayload();

      const events = await command.handle({
        type: SUITE_RUN_COMMAND_TYPES.START_SCENARIO,
        tenantId: payload.tenantId as TenantId,
        aggregateId: StartScenarioCommand.getAggregateId(payload),
        data: payload,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED);
      expect(events[0]!.data).toMatchObject({
        scenarioRunId: "sr-1",
        scenarioId: "s1",
        targetReferenceId: "t1",
        targetType: "http",
        batchRunId: "batch-1",
      });
    });
  });
});
