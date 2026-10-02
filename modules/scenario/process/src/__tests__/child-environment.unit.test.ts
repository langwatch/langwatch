/** @vitest-environment node
 * Child's env allowlist: voice-only forward of VOICE_PUBLIC_BASE_URL/
 * BASE_HOST/VOICE_WS_PORT is the only gate between operator and child.
 */
import { NLP_INTERNAL_SECRET_ENV } from "@langwatch/process/nlp-internal-secret";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildChildEnvironment } from "../services/node-scenario-child.service.ts";
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
  voicePublicUrl: { url: "https://voice.example.com" },
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

  describe("given a voice target whose worker has no public origin", () => {
    it("forwards the reason the phone run names", () => {
      const result = buildChildEnvironment({
        config: { ...config, voicePublicUrl: { unavailable: "spawn cloudflared ENOENT" } },
        jobData: jobData("voice"),
        labels: [],
        telemetry,
      });

      expect(result.VOICE_PUBLIC_BASE_URL).toBeUndefined();
      expect(result.VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON).toBe("spawn cloudflared ENOENT");
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

  describe("given the process resolved the engine's internal secret", () => {
    describe("when a child is started for any target", () => {
      it("forwards the secret so the adapters inside it can authenticate", () => {
        // The code and workflow adapters and the model factory run inside this
        // child and build their own requests to the engine, which refuses a
        // /go request carrying no secret once one is configured. Without the
        // forward a configured install 401s every simulation run against a
        // workflow or code agent while answering the parent fine.
        const result = buildChildEnvironment({
          config: { ...config, nlpInternalSecret: "shared-with-the-app" },
          jobData: jobData("http"),
          labels: [],
          telemetry,
        });

        expect(result[NLP_INTERNAL_SECRET_ENV]).toBe("shared-with-the-app");
      });
    });
  });

  describe("given the process resolved no internal secret", () => {
    describe("when a child is started", () => {
      it("binds nothing, so the child sends no secret header either", () => {
        const result = buildChildEnvironment({
          config,
          jobData: jobData("http"),
          labels: [],
          telemetry,
        });

        expect(result[NLP_INTERNAL_SECRET_ENV]).toBeUndefined();
      });
    });
  });
});
