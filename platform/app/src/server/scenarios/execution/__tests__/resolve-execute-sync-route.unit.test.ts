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
  mockEnv.LANGWATCH_ENDPOINT = "http://langwatch-internal";
  mockEnv.LANGWATCH_NLP_SERVICE = "http://nlp.internal:5561";
});

describe("the route a scenario run is prepared with", () => {
  describe("given the deployment is configured with per-project engines", () => {
    // Two scenarios, one assertion: the checker binds an annotation only when
    // it closes its own comment, so they stack rather than share a block.
    /** @scenario "A deployment with per-project engines relays" */
    /** @scenario "A relayed turn does not leave the deployment" */
    it("routes the run through the control plane, at the address the app hands out", () => {
      mockEnv.LANGWATCH_NLP_LAMBDA_CONFIG = '{"AWS_REGION":"eu-central-1"}';

      // Not BASE_HOST. The public hostname is served through a CDN that ends a
      // request the origin has not answered within 100 seconds, which is well
      // under the ten minutes a turn is allowed, so reading it here put every
      // long turn on that ceiling instead of the platform's.
      expect(resolveExecuteSyncRoute()).toEqual({
        mode: "relay",
        relayBaseUrl: "http://langwatch-internal",
      });
    });

    it("falls back to the public host when no endpoint is configured", () => {
      mockEnv.LANGWATCH_NLP_LAMBDA_CONFIG = '{"AWS_REGION":"eu-central-1"}';
      delete mockEnv.LANGWATCH_ENDPOINT;

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
