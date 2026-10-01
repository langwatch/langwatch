import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { parseUiFeatureConfig, uiDeploymentOf } from "../ui-feature-config";

const served: PublicAppConfig = {
  process: {
    appBaseUrl: "https://app.langwatch.test",
    mode: "production",
    deployment: "saas",
    nlp: false,
  },
  auth: {
    passkeys: true,
    identityFrontDoor: false,
    authProvider: "auth0",
    emailPasswordEnabled: true,
  },
  authz: {},
  billing: {},
  evaluation: { langevals: true },
  gateway: { gatewayBaseUrl: "https://gateway.langwatch.test" },
  notification: { email: true },
  ops: { cloudOps: false },
  rum: { enabled: true, sampleRatio: 0.1 },
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
        emailPasswordEnabled: true,
        gatewayBaseUrl: "https://gateway.langwatch.test",
      });
    });
  });

  describe("when auth names a public URL that differs from BASE_HOST", () => {
    /** @scenario "The browser deployment prefers the public URL over BASE_HOST" */
    it("hands the public URL to every setup snippet", () => {
      const deployment = uiDeploymentOf({
        config: parseUiFeatureConfig({
          ...served,
          auth: { ...served.auth, publicUrl: "https://langwatch.acme.example" },
        }),
        origin: "https://page.langwatch.test",
      });

      expect(deployment.appBaseUrl).toBe("https://langwatch.acme.example");
    });
  });

  describe("given a slice its owner's schema refuses", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("throws naming the owner rather than handing a feature a value it cannot act on", () => {
      expect(() =>
        parseUiFeatureConfig({ ...served, rum: { ...served.rum, sampleRatio: 2 } }),
      ).toThrow(/"rum"/);
    });
  });

  describe("given a page that carries no slice for an installed owner", () => {
    it("throws naming the missing owner", () => {
      const { notification: _dropped, ...withoutMail } = served;

      expect(() => parseUiFeatureConfig(withoutMail)).toThrow(/"notification"/);
    });
  });
});
