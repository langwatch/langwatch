import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { deriveUiDeployment } from "../deployment.ts";

/** A whole config, so a field the decoder stops reading fails here rather than being cast away. */
function configWith(overrides: Partial<PublicAppConfig>): PublicAppConfig {
  return {
    appBaseUrl: "https://app.example",
    gatewayBaseUrl: "https://gateway.example",
    deployment: "self-hosted",
    mode: "production",
    telemetry: { browserTracing: false, sampleRatio: 0 },
    capabilities: { email: true, nlp: true, langevals: true },
    passkeys: false,
    identityFrontDoor: false,
    ...overrides,
  };
}

describe("deriveUiDeployment", () => {
  it("reads the deployment shape off the injected config", () => {
    const deployment = deriveUiDeployment(configWith({ mode: "development", deployment: "saas" }));

    expect(deployment.isDevelopment).toBe(true);
    expect(deployment.isSaaS).toBe(true);
    expect(deployment.appBaseUrl).toBe("https://app.example");
  });

  describe("given a deployment that sells a licence", () => {
    it("carries the purchase address, so a host never reads the meta tag itself", () => {
      const deployment = deriveUiDeployment(
        configWith({ licensePaymentUrl: "https://buy.example/licence" }),
      );

      expect(deployment.licensePaymentUrl).toBe("https://buy.example/licence");
    });
  });

  describe("given a deployment that sells none", () => {
    it("omits the field rather than carrying an empty one", () => {
      expect("licensePaymentUrl" in deriveUiDeployment(configWith({}))).toBe(false);
    });
  });

  describe("given a deployment with mail configured", () => {
    it("says so, so the invite flow can claim the message went out", () => {
      expect(deriveUiDeployment(configWith({})).hasEmailProvider).toBe(true);
    });
  });

  describe("given a deployment with no mail provider", () => {
    it("says so, so the invite flow offers a link instead of claiming a send", () => {
      const deployment = deriveUiDeployment(
        configWith({ capabilities: { email: false, nlp: true, langevals: true } }),
      );

      expect(deployment.hasEmailProvider).toBe(false);
    });
  });

  describe("given no demo project", () => {
    it("omits the slug", () => {
      expect("demoProjectSlug" in deriveUiDeployment(configWith({}))).toBe(false);
    });
  });
});
