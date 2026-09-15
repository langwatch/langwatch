import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";
import { parseUiFeatureConfig } from "../ui-feature-config";

const served: PublicAppConfig = {
  appBaseUrl: "https://app.langwatch.test",
  gatewayBaseUrl: "https://gateway.langwatch.test",
  deployment: "saas",
  mode: "production",
  telemetry: { browserTracing: true, sampleRatio: 0.1 },
  capabilities: { email: true, nlp: false, langevals: true },
  passkeys: true,
  identityFrontDoor: false,
};

describe("browser feature configuration", () => {
  describe("given the configuration the HTML shell carries", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("hands each feature the slice its own schema accepts", () => {
      expect(parseUiFeatureConfig(served)).toEqual({
        auth: { passkeys: true, identityFrontDoor: false },
        billing: { licensePaymentUrl: undefined },
        deployment: { deployment: "saas" },
        evaluation: { langevals: true },
        gateway: { gatewayBaseUrl: "https://gateway.langwatch.test" },
        notification: { email: true },
        observability: { browserTracing: true, sampleRatio: 0.1 },
        workflow: { nlp: false },
      });
    });
  });

  describe("given a slice a feature's own schema refuses", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("throws rather than handing the feature a value it cannot act on", () => {
      expect(() =>
        parseUiFeatureConfig({
          ...served,
          telemetry: { ...served.telemetry, sampleRatio: 2 },
        }),
      ).toThrow();
    });
  });
});
