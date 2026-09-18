/**
 * @vitest-environment node
 *
 * The child's env allowlist. Covers the voice-only forward of
 * `VOICE_PUBLIC_BASE_URL` / `BASE_HOST` / `VOICE_WS_PORT`, which the phone
 * transport reads once it is running inside the pool child (see
 * `resolvePublicBaseUrl` / `resolveHttpPort` in `../../voice/transports/phone.transport.ts`).
 * This allowlist is the only gate between the operator's process env and the
 * child, so a variable missing here means the transport never sees it.
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
    describe("when VOICE_PUBLIC_BASE_URL and VOICE_WS_PORT are set on the parent's env", () => {
      it("forwards them, and the app's own BASE_HOST, to the child", () => {
        vi.stubEnv("VOICE_PUBLIC_BASE_URL", "https://voice.example.com");
        vi.stubEnv("VOICE_WS_PORT", "5564");

        const result = buildChildEnvironment({
          jobData: jobData("voice"),
          labels: [],
          telemetry,
        });

        expect(result.VOICE_PUBLIC_BASE_URL).toBe("https://voice.example.com");
        expect(result.BASE_HOST).toBe("https://app.example.com");
        expect(result.VOICE_WS_PORT).toBe("5564");
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
});
