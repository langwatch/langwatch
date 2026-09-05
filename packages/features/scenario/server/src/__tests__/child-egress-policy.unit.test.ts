/**
 * The fence a child dials an HTTP target through is the parent's decision, carried across the
 * process boundary.
 * Spec: specs/scenarios/child-execution-contract.feature
 */
import { describe, expect, it } from "vitest";
import {
  buildChildEnvironment,
  decodeScenarioEgressPolicy,
  SCENARIO_EGRESS_POLICY_ENV,
  type ScenarioChildProcessConfig,
} from "../index";

const config: ScenarioChildProcessConfig = {
  packageRoot: "/app/apps/worker",
  sourcePath: "/app/apps/worker/src/scenario-child.entrypoint.ts",
  sourceRoots: ["/app/apps/worker/src"],
  nodeEnv: "production",
  isSaas: false,
  egress: { blockLocal: true, allowedHosts: ["agents.internal"] },
  parentEnvironment: { path: "/usr/bin", home: "/app" },
};

const jobData = {
  projectId: "project-1",
  scenarioId: "scenario-1",
  scenarioRunId: "run-1",
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "http", referenceId: "agent-1" },
} as never;

describe("given the egress policy a scenario child dials an HTTP target through", () => {
  describe("when the parent builds the child's environment", () => {
    /** @scenario "The child is handed the deployment's own egress policy" */
    it("carries the deployment's own policy rather than a default", () => {
      const environment = buildChildEnvironment({
        config,
        jobData,
        labels: [],
        telemetry: { endpoint: "https://ingest.test", apiKey: "key" },
      });

      expect(decodeScenarioEgressPolicy(environment[SCENARIO_EGRESS_POLICY_ENV])).toEqual({
        blockLocal: true,
        allowedHosts: ["agents.internal"],
      });
    });
  });

  describe("when a child is started without one", () => {
    /** @scenario "A child handed no egress policy refuses rather than assuming one" */
    it("fails by naming the variable instead of defaulting the fence open", () => {
      expect(() => decodeScenarioEgressPolicy(undefined)).toThrow(SCENARIO_EGRESS_POLICY_ENV);
    });
  });
});
