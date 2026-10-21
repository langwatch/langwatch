/**
 * @see specs/scenarios/secret-run-parameters.feature
 * @see modules/scenario/specs/simulation-run.feature
 */
import { isRunNotScored } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  mapClickHouseRowToScenarioRunData,
  type ClickHouseSimulationRunRow,
} from "../simulation-run.mapper.ts";

function row(overrides: Partial<ClickHouseSimulationRunRow> = {}): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Refund flow",
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    StartedAt: "1000",
    CreatedAt: "1000",
    UpdatedAt: "2000",
    FinishedAt: "2000",
    ArchivedAt: null,
    ...overrides,
  };
}

describe("mapClickHouseRowToScenarioRunData", () => {
  describe("given a stored run that used a secret parameter", () => {
    /** @scenario "The runs API never returns a secret value" */
    it("serves the run back without a value or an encrypted form", () => {
      const data = mapClickHouseRowToScenarioRunData(
        row({
          Metadata: JSON.stringify({
            parameters: { region: "eu-central" },
            secretParameterNames: ["api_token"],
            secretParameters: { api_token: "enc:tok-live-1" },
          }),
        }),
      );

      const served = JSON.stringify(data);
      expect(served).not.toContain("tok-live-1");
      expect(served).not.toContain("secretParameters");
      expect(data.metadata).toMatchObject({ secretParameterNames: ["api_token"] });
    });
  });

  describe("given a stored run whose platform namespace names a target type the platform does not know", () => {
    const stored = (langwatch: Record<string, unknown>) =>
      row({ Metadata: JSON.stringify({ name: "Refund flow", langwatch }) });

    /** @scenario "A run stamped with a target type outside today's set still reads, with no target type" */
    it("reads the run with no target type and keeps the rest of its platform context", () => {
      const data = mapClickHouseRowToScenarioRunData(
        stored({
          targetReferenceId: "agent_1",
          targetType: "agent",
          simulationSuiteId: "suite_1",
          scenarioVersion: 3,
          judgeModel: "openai/gpt-5-mini",
          actorId: "user-1",
        }),
      );

      expect(data.scenarioRunId).toBe("run-1");
      expect(data.metadata?.name).toBe("Refund flow");
      expect(data.metadata?.langwatch?.targetType).toBeUndefined();
      expect(data.metadata?.langwatch).toMatchObject({
        targetReferenceId: "agent_1",
        simulationSuiteId: "suite_1",
        scenarioVersion: 3,
        judgeModel: "openai/gpt-5-mini",
        actorId: "user-1",
      });
    });

    /** @scenario "A run stamped with a target type outside today's set still reads, with no target type" */
    it("reads a run whose namespace carries no target type at all", () => {
      const data = mapClickHouseRowToScenarioRunData(stored({ targetReferenceId: "agent_1" }));

      expect(data.metadata?.langwatch?.targetType).toBeUndefined();
      expect(data.metadata?.langwatch?.targetReferenceId).toBe("agent_1");
    });

    /** @scenario "A run whose platform context holds another unreadable field drops only that field" */
    it("drops only the unreadable field and keeps the rest of its platform context", () => {
      const data = mapClickHouseRowToScenarioRunData(
        stored({
          targetReferenceId: "agent_1",
          targetType: "http",
          simulationSuiteId: "suite_1",
          scenarioVersion: "three",
          judgeModel: "openai/gpt-5-mini",
          actorId: "user-1",
          agentInstance: { hostname: "box-1", label: null },
        }),
      );

      expect(data.scenarioRunId).toBe("run-1");
      expect(data.metadata?.name).toBe("Refund flow");
      expect(data.metadata?.langwatch?.scenarioVersion).toBeUndefined();
      expect(data.metadata?.langwatch).toMatchObject({
        targetReferenceId: "agent_1",
        targetType: "http",
        simulationSuiteId: "suite_1",
        judgeModel: "openai/gpt-5-mini",
        actorId: "user-1",
        agentInstance: { hostname: "box-1", label: null },
      });
    });

    /** @scenario "An unreadable hooks value keeps its setup status, so a run whose setup failed stays unscored" */
    it("keeps the setup status of an unreadable hooks value and drops one with none", () => {
      const kept = mapClickHouseRowToScenarioRunData(
        stored({
          targetReferenceId: "agent_1",
          hooks: { setup: { status: "failed", durationMs: "slow", error: 7 } },
        }),
      );
      const dropped = mapClickHouseRowToScenarioRunData(
        stored({
          targetReferenceId: "agent_1",
          judgeModel: "openai/gpt-5-mini",
          hooks: { setup: { status: "bogus", durationMs: 1 } },
        }),
      );

      expect(kept.metadata?.langwatch?.hooks).toEqual({
        setup: { status: "failed", durationMs: 0 },
      });
      expect(isRunNotScored(kept.metadata?.langwatch?.hooks)).toBe(true);
      expect(dropped.metadata?.langwatch?.hooks).toBeUndefined();
      expect(dropped.metadata?.langwatch?.judgeModel).toBe("openai/gpt-5-mini");
    });

    /** @scenario "An unreadable hooks value keeps its setup status, so a run whose setup failed stays unscored" */
    it("reads a valid full hooks value and keepData back unchanged", () => {
      const hooks = {
        setup: { status: "ok", durationMs: 400, state: { order_id: "42" } },
        teardown: { status: "failed", durationMs: 90, error: "boom" },
      };
      const data = mapClickHouseRowToScenarioRunData(
        stored({ targetReferenceId: "agent_1", targetType: "connected", hooks, keepData: true }),
      );

      expect(data.metadata?.langwatch).toMatchObject({
        targetReferenceId: "agent_1",
        targetType: "connected",
        hooks,
        keepData: true,
      });
    });

    /** @scenario "A run whose platform context names no readable target still reads, with no platform context" */
    it("reads a run with no readable target reference id with no platform context", () => {
      const data = mapClickHouseRowToScenarioRunData(
        stored({ targetReferenceId: 42, targetType: "http", simulationSuiteId: "suite_1" }),
      );

      expect(data.scenarioRunId).toBe("run-1");
      expect(data.metadata?.name).toBe("Refund flow");
      expect(data.metadata?.langwatch).toBeUndefined();
    });

    /** @scenario "A run stamped with a target type in another case reads as that target" */
    it("reads a target type written in another case as the known type", () => {
      const data = mapClickHouseRowToScenarioRunData(
        stored({ targetReferenceId: "agent_1", targetType: " HTTP " }),
      );

      expect(data.metadata?.langwatch).toMatchObject({
        targetReferenceId: "agent_1",
        targetType: "http",
      });
    });
  });
});
