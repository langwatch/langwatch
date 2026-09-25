import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { parseUiFeatureConfig, uiDeploymentOf } from "../ui-feature-config";

const served: PublicAppConfig = {
  process: {
    appBaseUrl: "https://app.langwatch.test",
    mode: "production",
    deployment: "saas",
    nlp: false,
    browserTracing: true,
    sampleRatio: 0.1,
  },
  auth: { passkeys: true, identityFrontDoor: false, authProvider: "auth0" },
  authz: {},
  billing: {},
  evaluation: { langevals: true },
  gateway: { gatewayBaseUrl: "https://gateway.langwatch.test" },
  notification: { email: true },
  ops: {},
};

describe("browser feature configuration", () => {
  describe("given the configuration the HTML shell carries", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("hands each owner's slice through the schema its contract declared", () => {
      expect(parseUiFeatureConfig(served)).toEqual(served);
    });

    it("reads the deployment capability off those slices", () => {
      const deployment = uiDeploymentOf({
        config: parseUiFeatureConfig(served),
        origin: "https://page.langwatch.test",
      });

      expect(deployment).toMatchObject({
        isSaaS: true,
        appBaseUrl: "https://app.langwatch.test",
        hasNlpService: false,
        hasLangevals: true,
        hasEmailProvider: true,
        authProvider: "auth0",
        passkeysEnabled: true,
      });
    });
  });

  describe("given a slice its owner's schema refuses", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("throws naming the owner rather than handing a feature a value it cannot act on", () => {
      expect(() =>
        parseUiFeatureConfig({ ...served, process: { ...served.process, sampleRatio: 2 } }),
      ).toThrow(/"process"/);
    });
  });

  describe("given a page that carries no slice for an installed owner", () => {
    it("throws naming the missing owner", () => {
      const { notification: _dropped, ...withoutMail } = served;

      expect(() => parseUiFeatureConfig(withoutMail)).toThrow(/"notification"/);
    });
  });
});
