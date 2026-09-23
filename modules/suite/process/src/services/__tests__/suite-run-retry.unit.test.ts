import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @see specs/suites/suite-run-retry-safety.feature
 */
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { SuiteTarget } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { CollapsingRunCommands } from "../../__tests__/support/collapsing-run-commands.ts";
import { SuiteExecutionService } from "../suite-execution.service.ts";

const AGENT: SuiteTarget = { type: "http", referenceId: "agent_1" };
const OTHER_AGENT: SuiteTarget = { type: "http", referenceId: "agent_2" };

function scenarios(): ScenarioApi {
  return createApiFixture<ScenarioApi>({
    resolveRunParametersForScenarios: async (input) =>
      input.scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        scenarioVersion: 1,
        parameters: {},
        secretParameters: {},
      })),
  });
}

type ExecuteInput = Parameters<SuiteExecutionService["execute"]>[0];

/** Two scenarios against one agent, as the run service resolved them. */
function request(overrides: Partial<ExecuteInput> = {}): ExecuteInput {
  const activeScenarioIds = overrides.activeScenarioIds ?? ["scenario_1", "scenario_2"];

  return {
    suiteId: "suite_1",
    projectId: "project_1",
    activeScenarioIds,
    scenarioNames: new Map(activeScenarioIds.map((id) => [id, `Scenario ${id}`])),
    scenarioVersions: new Map(activeScenarioIds.map((id) => [id, 1])),
    scenarioConfigs: activeScenarioIds.map((id) => ({
      id,
      name: `Scenario ${id}`,
      version: 1,
      situation: "A situation",
      criteria: [],
      parameters: {},
    })),
    activeTargets: [AGENT],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: "request_1",
    ...overrides,
  };
}

/** The real service over a queue that collapses a command it has already seen. */
function execution() {
  const commands = new CollapsingRunCommands();

  return {
    commands,
    service: SuiteExecutionService.create({ commands, scenarios: scenarios() }),
  };
}

describe("given a run plan over two scenarios and one target", () => {
  describe("when the same run is requested twice with one idempotency key", () => {
    /** @scenario "A retry carrying the same key is the same run" */
    it("answers the same batch run id both times", async () => {
      const { service } = execution();

      const first = await service.execute(request());
      const retry = await service.execute(request());

      expect(retry.batchRunId).toBe(first.batchRunId);
    });

    /** @scenario "A retry carrying the same key starts the runs already started" */
    it("starts the runs it already started rather than new ones", async () => {
      const { service, commands } = execution();

      const first = await service.execute(request());
      const retry = await service.execute(request());

      expect(retry.items.map((item) => item.scenarioRunId)).toEqual(
        first.items.map((item) => item.scenarioRunId),
      );
      expect(commands.queued).toHaveLength(2);
      expect(commands.queued.map((one) => one.scenarioId)).toEqual(["scenario_1", "scenario_2"]);
    });

    /** @scenario "A retry carrying the same key records the run once" */
    it("records one suite run", async () => {
      const { service, commands } = execution();

      await service.execute(request());
      await service.execute(request());

      expect(commands.started).toHaveLength(1);
      expect(commands.started[0]?.total).toBe(2);
    });
  });

  describe("when the same configuration is requested twice under two idempotency keys", () => {
    /** @scenario "Two requests with different keys are different runs" */
    it("answers two runs that share nothing", async () => {
      const { service } = execution();

      const first = await service.execute(request({ idempotencyKey: "request_1" }));
      const second = await service.execute(request({ idempotencyKey: "request_2" }));

      expect(second.batchRunId).not.toBe(first.batchRunId);
      const firstRunIds = new Set(first.items.map((item) => item.scenarioRunId));
      for (const item of second.items) {
        expect(firstRunIds.has(item.scenarioRunId)).toBe(false);
      }
    });
  });

  describe("when one key is sent over a configuration that is not the same configuration", () => {
    /** @scenario "One key over a different configuration is a different run" */
    it("answers its own run for a different target", async () => {
      const { service } = execution();

      const first = await service.execute(request());
      const other = await service.execute(request({ activeTargets: [OTHER_AGENT] }));

      expect(other.batchRunId).not.toBe(first.batchRunId);
    });

    /** @scenario "One key over a different set of scenarios is a different run" */
    it("answers its own run for a different set of scenarios", async () => {
      const { service } = execution();

      const first = await service.execute(request());
      const fewer = await service.execute(request({ activeScenarioIds: ["scenario_1"] }));

      expect(fewer.batchRunId).not.toBe(first.batchRunId);
    });

    /** @scenario "One key over different run parameters is a different run" */
    it("answers its own run for a different parameter value", async () => {
      const { service } = execution();

      const first = await service.execute(request({ parameters: { tier: "gold" } }));
      const other = await service.execute(request({ parameters: { tier: "silver" } }));

      expect(other.batchRunId).not.toBe(first.batchRunId);
    });
  });

  describe("when the caller chooses the batch run id itself", () => {
    /** @scenario "A caller that sends a batch run id keeps it" */
    it("answers the id the caller sent", async () => {
      const { service } = execution();

      const result = await service.execute(request({ batchRunId: "scenariobatch_chosen" }));

      expect(result.batchRunId).toBe("scenariobatch_chosen");
    });

    /** @scenario "A retry that pins the same batch run id starts the runs already started" */
    it("starts the runs it already started", async () => {
      const { service, commands } = execution();

      const first = await service.execute(request({ batchRunId: "scenariobatch_chosen" }));
      const retry = await service.execute(request({ batchRunId: "scenariobatch_chosen" }));

      expect(retry.items.map((item) => item.scenarioRunId)).toEqual(
        first.items.map((item) => item.scenarioRunId),
      );
      expect(commands.queued).toHaveLength(2);
    });
  });

  describe("when a run is requested", () => {
    /** @scenario "A derived batch run id is still a batch run id" */
    it("names the kinds a minted id names", async () => {
      const { service } = execution();

      const result = await service.execute(request());

      expect(result.batchRunId.startsWith("scenariobatch_")).toBe(true);
      for (const item of result.items) {
        expect(item.scenarioRunId.startsWith("scenariorun_")).toBe(true);
      }
    });
  });
});

describe("given a run plan over two scenarios, two targets and a repeat count of two", () => {
  describe("when a run is requested", () => {
    /** @scenario "Every item of one batch has its own scenario run id" */
    it("queues eight runs under eight ids", async () => {
      const { service, commands } = execution();

      const result = await service.execute(
        request({ activeTargets: [AGENT, OTHER_AGENT], repeatCount: 2 }),
      );

      expect(result.items).toHaveLength(8);
      expect(new Set(result.items.map((item) => item.scenarioRunId)).size).toBe(8);
      expect(commands.queued).toHaveLength(8);
    });
  });
});
