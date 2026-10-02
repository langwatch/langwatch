/**
 * @vitest-environment node
 *
 * The child's env allowlist. Covers the voice-only forward of
 * `VOICE_PUBLIC_BASE_URL` / `BASE_HOST`, which the phone transport reads once
 * it is running inside the pool child (see `resolvePublicBaseUrl` in
 * `../../voice/transports/phone.transport.ts`). This allowlist is the only
 * gate between the operator's process env and the child, so a variable
 * missing here means the transport never sees it. `VOICE_WS_PORT` is
 * deliberately excluded from the allowlist: forwarding it is what let the
 * child bind the parent worker's own media-listener port.
 *
 * @see specs/features/agents/voice-phone.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: {
    BASE_HOST: "https://app.example.com",
    IS_SAAS: false,
  },
}));

import { buildChildEnvironment } from "../child-environment";
import type { ExecutionJobData } from "../execution-pool";

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

describe("buildChildEnvironment", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("given a voice target", () => {
    describe("when VOICE_PUBLIC_BASE_URL is set on the parent's env", () => {
      it("forwards it, and the app's own BASE_HOST, to the child", () => {
        vi.stubEnv("VOICE_PUBLIC_BASE_URL", "https://voice.example.com");

        const result = buildChildEnvironment({
          jobData: jobData("voice"),
          labels: [],
          telemetry,
        });

        expect(result.VOICE_PUBLIC_BASE_URL).toBe("https://voice.example.com");
        expect(result.BASE_HOST).toBe("https://app.example.com");
      });
    });

    describe("when VOICE_WS_PORT is set on the parent's env", () => {
      it("never forwards it to the child", () => {
        vi.stubEnv("VOICE_WS_PORT", "5564");

        const result = buildChildEnvironment({
          jobData: jobData("voice"),
          labels: [],
          telemetry,
        });

        expect(result.VOICE_WS_PORT).toBeUndefined();
      });
    });
  });

  describe("given a non-voice target", () => {
    describe("when the parent's env carries the same voice-only variables", () => {
      it("never forwards them to the child", () => {
        vi.stubEnv("VOICE_PUBLIC_BASE_URL", "https://voice.example.com");
        vi.stubEnv("VOICE_WS_PORT", "5564");

        const result = buildChildEnvironment({
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

  describe("given the engine's internal secret is configured on the parent", () => {
    describe("when a child is started for any target", () => {
      it("forwards the secret so the adapters inside it can authenticate", () => {
        // The code and workflow adapters and the model factory run inside this
        // child and build their own requests to nlpgo. nlpgo refuses a /go
        // request with no secret once one is configured, so without the
        // forward a configured install 401s every simulation run against a
        // workflow or code agent while the engine answers the parent fine.
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", "shared-with-the-app");

        const result = buildChildEnvironment({
          jobData: jobData("http"),
          labels: [],
          telemetry,
        });

        expect(result.LANGWATCH_NLP_INTERNAL_SECRET).toBe(
          "shared-with-the-app",
        );
      });
    });
  });

  describe("given no internal secret on the parent", () => {
    describe("when a child is started", () => {
      it("binds nothing, so the child sends no secret header either", () => {
        const result = buildChildEnvironment({
          jobData: jobData("http"),
          labels: [],
          telemetry,
        });

        expect(result.LANGWATCH_NLP_INTERNAL_SECRET).toBeUndefined();
      });
    });
  });
});
