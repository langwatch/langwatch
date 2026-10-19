/**
 * @vitest-environment node
 *
 * @see specs/scenarios/go-scenario-runner-choice.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { ScenarioChildExecutionSession } from "../app/scenario.app.ts";
import type {
  ScenarioChildChannel,
  ScenarioChildNonceRegistry,
  ScenarioChildRunPool,
  ScenarioGoChildChannel,
} from "../channels/scenario-child.channel.ts";
import {
  SCENARIO_GO_RUNNER_FLAG_KEY,
  ScenarioChildChoiceService,
} from "../features/child/services/scenario-child-choice.service.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";

function job(type: ExecutionJobData["target"]["type"]): ExecutionJobData {
  return {
    projectId: "project-1",
    scenarioId: "scenario-1",
    scenarioRunId: "run-1",
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type, referenceId: "agent-1" },
  };
}

const environment = { labels: [], telemetry: { endpoint: "https://x.test", apiKey: "key" } };

function harness({
  flag,
  namesBinary = true,
  binaryOnDisk = true,
}: {
  flag: boolean | Error;
  namesBinary?: boolean;
  binaryOnDisk?: boolean;
}) {
  const binaryPath = namesBinary ? "/usr/local/bin/scenariorunner" : undefined;
  const session = createApiFixture<ScenarioChildExecutionSession>({}, "Session");
  const nodeStart = vi.fn(async () => session);
  const goStart = vi.fn(async () => session);
  const isEnabled = vi.fn(async () => {
    if (flag instanceof Error) throw flag;
    return flag;
  });
  const binaryExists = vi.fn(() => binaryOnDisk);
  const pool = createApiFixture<ScenarioChildRunPool>({}, "Pool");
  const nonces = createApiFixture<ScenarioChildNonceRegistry>({}, "Nonces");
  const choice = ScenarioChildChoiceService.create({
    node: createApiFixture<ScenarioChildChannel>({ start: nodeStart }, "Node child"),
    go: createApiFixture<ScenarioGoChildChannel>({ start: goStart, binaryPath }, "Go runner"),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled }, "FeatureFlags"),
    binaryExists,
    pool,
    nonces,
  });
  return { choice, nodeStart, goStart, isEnabled, binaryExists, pool, nonces };
}

describe("ScenarioChildChoiceService", () => {
  describe("given the project's Go runner flag is off", () => {
    /** @scenario "A run starts on the Node child while the flag is off" */
    it("spawns the Node scenario child and never the Go runner", async () => {
      const { choice, nodeStart, goStart, isEnabled } = harness({ flag: false });

      await choice.start({ jobData: job("http"), environment });

      expect(nodeStart).toHaveBeenCalledTimes(1);
      expect(goStart).not.toHaveBeenCalled();
      expect(isEnabled).toHaveBeenCalledWith(SCENARIO_GO_RUNNER_FLAG_KEY, {
        kind: "project",
        projectId: "project-1",
      });
    });
  });

  describe("given the project's Go runner flag is on and the binary is on disk", () => {
    /** @scenario "A run starts on the Go runner while the flag is on" */
    it("spawns the Go runner with the same job data and environment", async () => {
      const { choice, nodeStart, goStart, pool, nonces } = harness({ flag: true });
      const jobData = job("http");

      await choice.start({ jobData, environment });

      expect(goStart).toHaveBeenCalledWith({
        jobData,
        environment,
        pool,
        nonces,
        voicePublicUrl: undefined,
      });
      expect(nodeStart).not.toHaveBeenCalled();
    });

    /** @scenario "A voice run stays on the Node child whatever the flag says" */
    it("keeps a voice run on the Node child without reading the flag", async () => {
      const { choice, nodeStart, goStart, isEnabled } = harness({ flag: true });

      await choice.start({ jobData: job("voice"), environment });

      expect(nodeStart).toHaveBeenCalledTimes(1);
      expect(goStart).not.toHaveBeenCalled();
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("given the flag cannot be read", () => {
    /** @scenario "A flag read that fails keeps the run on the Node child" */
    it("starts the run on the Node child", async () => {
      const { choice, nodeStart, goStart } = harness({ flag: new Error("store down") });

      await choice.start({ jobData: job("http"), environment });

      expect(nodeStart).toHaveBeenCalledTimes(1);
      expect(goStart).not.toHaveBeenCalled();
    });
  });

  describe("given the flag is on but the binary is not on disk", () => {
    /** @scenario "A missing binary falls back to the Node child and is looked for once" */
    it("starts both runs on the Node child and looks for the binary once", async () => {
      const { choice, nodeStart, goStart, binaryExists } = harness({
        flag: true,
        binaryOnDisk: false,
      });

      await choice.start({ jobData: job("http"), environment });
      await choice.start({ jobData: job("prompt"), environment });

      expect(nodeStart).toHaveBeenCalledTimes(2);
      expect(goStart).not.toHaveBeenCalled();
      expect(binaryExists).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the worker names no Go runner binary", () => {
    /** @scenario "A worker that names no binary keeps runs on the Node child" */
    it("starts the run on the Node child", async () => {
      const { choice, nodeStart, goStart, binaryExists } = harness({
        flag: true,
        namesBinary: false,
      });

      await choice.start({ jobData: job("http"), environment });

      expect(nodeStart).toHaveBeenCalledTimes(1);
      expect(goStart).not.toHaveBeenCalled();
      expect(binaryExists).not.toHaveBeenCalled();
    });
  });
});
