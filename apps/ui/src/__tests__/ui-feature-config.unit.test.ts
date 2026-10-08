import { describe, expect, it } from "vitest";

import { uiDeploymentOf, uiTelemetryOf } from "../ui-feature-config";
import { servedConfig, uiFeatureConfigFrom } from "./ui-feature-config.fixtures";

describe("browser feature configuration", () => {
  describe("given the configuration the HTML shell carries", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("hands the shell each installed module's projection of the slices it claims", async () => {
      const config = await uiFeatureConfigFrom(servedConfig);

      expect(config).toEqual({
        process: servedConfig.process,
        auth: {
          authProvider: "auth0",
          passkeysEnabled: true,
          emailPasswordEnabled: true,
          signUpMode: "invite_only",
        },
        authz: {},
        billing: {},
        evaluator: { hasLangevals: true },
        gateway: { gatewayBaseUrl: "https://gateway.langwatch.test" },
        notification: { hasEmailProvider: true },
        ops: { cloudOps: false, browserTracing: true, sampleRatio: 0.1 },
      });
    });

    it("reads the deployment capability and the telemetry off those projections", async () => {
      const config = await uiFeatureConfigFrom(servedConfig);

      expect(uiDeploymentOf({ config, origin: "https://page.langwatch.test" })).toMatchObject({
        isSaaS: true,
        appBaseUrl: "https://app.langwatch.test",
        hasNlpService: false,
        hasLangevals: true,
        hasEmailProvider: true,
        authProvider: "auth0",
        passkeysEnabled: true,
        emailPasswordEnabled: true,
        signUpMode: "invite_only",
        hasCloudOps: false,
        gatewayBaseUrl: "https://gateway.langwatch.test",
      });
      expect(uiTelemetryOf(config)).toEqual({
        mode: "production",
        telemetry: { cloudOps: false, browserTracing: true, sampleRatio: 0.1 },
      });
    });
  });

  describe("when auth names a public URL that differs from BASE_HOST", () => {
    /** @scenario "The browser deployment prefers the public URL over BASE_HOST" */
    it("hands the public URL to every setup snippet", async () => {
      const config = await uiFeatureConfigFrom({
        ...servedConfig,
        auth: { ...servedConfig.auth, publicUrl: "https://langwatch.acme.example" },
      });

      expect(uiDeploymentOf({ config, origin: "https://page.langwatch.test" }).appBaseUrl).toBe(
        "https://langwatch.acme.example",
      );
    });
  });

  describe("given a slice its owner's schema refuses", () => {
    /** @scenario "The browser validates its configuration before the first render" */
    it("refuses naming the module that claims it", async () => {
      await expect(
        uiFeatureConfigFrom({ ...servedConfig, evaluation: { langevals: "yes" } }),
      ).rejects.toMatchObject({ code: "browser_config_refused", module: "evaluator" });
    });

    it("throws naming an owner still read by the shell", async () => {
      await expect(
        uiFeatureConfigFrom({ ...servedConfig, rum: { ...servedConfig.rum, sampleRatio: 2 } }),
      ).rejects.toThrow(/"rum"/);
    });
  });

  describe("given a slice no installed module claims", () => {
    it("refuses naming the owner", async () => {
      await expect(uiFeatureConfigFrom({ ...servedConfig, saas: {} })).rejects.toMatchObject({
        code: "browser_config_refused",
        owner: "saas",
      });
    });
  });

  describe("given a page that carries no slice for an installed owner", () => {
    it("throws naming the missing owner", async () => {
      const { notification: _dropped, ...withoutMail } = servedConfig;

      await expect(uiFeatureConfigFrom(withoutMail)).rejects.toThrow(/"notification"/);
    });
  });
});
