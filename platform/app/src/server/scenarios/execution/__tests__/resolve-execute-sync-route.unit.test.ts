/**
 * Which route the parent chooses for a scenario turn's execute_sync.
 *
 * The evidence is LANGWATCH_NLP_LAMBDA_CONFIG, the AWS credential that creates
 * and invokes the per-project engines. Its presence is what says this
 * deployment has them, and it is exactly the credential that must not reach
 * the child, so the decision belongs here and the answer travels on the job.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

import { resolveExecuteSyncRoute } from "../resolve-execute-sync-route";

beforeEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  mockEnv.BASE_HOST = "https://app.langwatch.ai";
  mockEnv.LANGWATCH_NLP_SERVICE = "http://nlp.internal:5561";
});

describe("the route a scenario run is prepared with", () => {
  describe("given the deployment is configured with per-project engines", () => {
    /** @scenario "A deployment with per-project engines relays" */
    it("routes the run through the control plane", () => {
      mockEnv.LANGWATCH_NLP_LAMBDA_CONFIG = '{"AWS_REGION":"eu-central-1"}';

      expect(resolveExecuteSyncRoute()).toEqual({
        mode: "relay",
        relayBaseUrl: "https://app.langwatch.ai",
      });
    });
  });

  describe("given the deployment has no per-project engines", () => {
    /** @scenario "A deployment with one engine posts to it directly" */
    it("routes the run straight to the engine it already configured", () => {
      expect(resolveExecuteSyncRoute()).toEqual({
        mode: "direct",
        nlpServiceUrl: "http://nlp.internal:5561",
      });
    });

    it("treats an empty configuration as no per-project engines", () => {
      mockEnv.LANGWATCH_NLP_LAMBDA_CONFIG = "";

      expect(resolveExecuteSyncRoute()).toMatchObject({ mode: "direct" });
    });
  });
});
