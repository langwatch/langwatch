/**
 * The child never holds the per-project engine credential, which may invoke ANY project's engine:
 * its environment is an allow-list, so a parent holding these still starts a child without them.
 * @see specs/scenarios/execute-sync-relay.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildChildEnvironment,
  type ScenarioChildProcessConfig,
} from "../services/node-scenario-child.service.ts";

/** Set for real on the parent, so a forward added later picks them up and fails here. */
const TENANT_WIDE_PARENT_ENV = {
  LANGWATCH_NLP_LAMBDA_CONFIG: '{"AWS_ACCESS_KEY_ID":"AKIAPARENT"}',
  AWS_ACCESS_KEY_ID: "AKIAPARENT",
  AWS_SECRET_ACCESS_KEY: "parent-secret",
  AWS_SESSION_TOKEN: "parent-token",
  AWS_REGION: "eu-central-1",
  DATABASE_URL: "postgres://parent/db",
};

const config: ScenarioChildProcessConfig = {
  packageRoot: "/app/modules/scenario/process",
  sourcePath: "/app/modules/scenario/process/src/services/scenario-child-execution.service.ts",
  sourceRoots: ["/app/modules/scenario/process/src"],
  nodeEnv: "production",
  isSaas: true,
  egress: { blockLocal: true, allowedHosts: [] },
  nlpInternalSecret: "engine-secret",
  parentEnvironment: { path: "/usr/bin", home: "/app", lang: "en_US.UTF-8" },
};

function childEnvironment() {
  return buildChildEnvironment({
    config,
    jobData: {
      projectId: "project_1",
      scenarioId: "scenario_1",
      scenarioRunId: "run_1",
      batchRunId: "batch_1",
      setId: "set_1",
      target: { type: "code", referenceId: "agent_1" },
    },
    labels: [],
    telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
  });
}

beforeEach(() => {
  for (const [key, value] of Object.entries(TENANT_WIDE_PARENT_ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the environment a scenario child is started with", () => {
  /** @scenario "The child's environment carries no AWS or per-project engine credential" */
  it("carries no AWS credential and no per-project engine configuration", () => {
    const environment = childEnvironment();

    for (const key of Object.keys(TENANT_WIDE_PARENT_ENV)) {
      expect(environment[key]).toBeUndefined();
    }
  });

  it("names nothing that looks like an AWS or Lambda credential at all", () => {
    expect(Object.keys(childEnvironment()).filter((key) => /^AWS_|LAMBDA/i.test(key))).toEqual([]);
  });
});
