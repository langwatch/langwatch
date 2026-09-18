/** @vitest-environment node
 * Child's env allowlist: voice-only forward of VOICE_PUBLIC_BASE_URL/
 * BASE_HOST/VOICE_WS_PORT is the only gate between operator and child.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildChildEnvironment } from "../services/node-scenario-child-process.service.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";

function jobData(target: ExecutionJobData["target"]["type"]): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: "scenario-1",
    scenarioRunId: "run-1",
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: target, referenceId: "agent-1" },
  };
}

const telemetry = { endpoint: "http://app:5560", apiKey: "key" };
const config = {
  packageRoot: "/app",
  sourcePath: "/app/src/child.ts",
  sourceRoots: ["/app/src"],
  nodeEnv: "test",
  isSaas: false,
  voicePublicBaseUrl: "https://voice.example.com",
  baseHost: "https://app.example.com",
  egress: { blockLocal: false, allowedHosts: [] },
  parentEnvironment: {},
};

describe("buildChildEnvironment", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("given a voice target", () => {
    describe("when the parent resolved its public origins", () => {
      it("forwards them without forwarding the worker's media port", () => {
        vi.stubEnv("VOICE_WS_PORT", "5564");

        const result = buildChildEnvironment({
          config,
          jobData: jobData("voice"),
          labels: [],
          telemetry,
        });

        expect(result.VOICE_PUBLIC_BASE_URL).toBe("https://voice.example.com");
        expect(result.BASE_HOST).toBe("https://app.example.com");
        expect(result.VOICE_WS_PORT).toBeUndefined();
      });
    });
  });

  describe("given a non-voice target", () => {
    describe("when the parent config carries the same voice-only variables", () => {
      it("never forwards them to the child", () => {
        vi.stubEnv("VOICE_WS_PORT", "5564");

        const result = buildChildEnvironment({
          config,
          jobData: jobData("http"),
          labels: [],
          telemetry,
        });

        expect(result.VOICE_PUBLIC_BASE_URL).toBeUndefined();
        expect(result.BASE_HOST).toBeUndefined();
        expect(result.VOICE_WS_PORT).toBeUndefined();
      });
    });
  });
});
