/**
 * Which route the parent chooses for a scenario turn's execute_sync; the answer travels on the job.
 * specs/scenarios/execute-sync-relay.feature
 */
import { describe, expect, it } from "vitest";

import { resolveExecuteSyncRoute } from "../execute-sync-route.rules.ts";

const DEPLOYMENT = {
  langwatchEndpoint: "http://langwatch-internal",
  baseHost: "https://app.langwatch.ai",
  nlpServiceUrl: "http://nlp.internal:5561",
};

describe("the route a scenario run is prepared with", () => {
  describe("given the deployment is configured with per-project engines", () => {
    /** @scenario "A deployment with per-project engines relays" */
    /** @scenario "A relayed turn does not leave the deployment" */
    it("routes the run through the control plane, at the address the app hands out", () => {
      expect(resolveExecuteSyncRoute({ ...DEPLOYMENT, perProjectEngines: true })).toEqual({
        mode: "relay",
        relayBaseUrl: "http://langwatch-internal",
      });
    });

    it.each([undefined, ""])(
      "falls back to the public host when the endpoint is %j",
      (endpoint) => {
        expect(
          resolveExecuteSyncRoute({
            ...DEPLOYMENT,
            langwatchEndpoint: endpoint,
            perProjectEngines: true,
          }),
        ).toEqual({ mode: "relay", relayBaseUrl: "https://app.langwatch.ai" });
      },
    );
  });

  describe("given the deployment has no per-project engines", () => {
    /** @scenario "A deployment with one engine posts to it directly" */
    it("routes the run straight to the engine it already configured", () => {
      expect(resolveExecuteSyncRoute({ ...DEPLOYMENT, perProjectEngines: false })).toEqual({
        mode: "direct",
        nlpServiceUrl: "http://nlp.internal:5561",
      });
    });
  });
});
