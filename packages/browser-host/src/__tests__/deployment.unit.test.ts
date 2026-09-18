import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { deriveUiDeployment } from "../deployment.ts";

/** Only the fields the decoder reads; the rest of the shape is not its business. */
function configWith(overrides: Partial<PublicAppConfig>): PublicAppConfig {
  return {
    mode: "production",
    deployment: "self-hosted",
    capabilities: { nlp: true, langevals: true },
    ...overrides,
  } as PublicAppConfig;
}

describe("deriveUiDeployment", () => {
  it("reads the deployment shape off the injected config", () => {
    const deployment = deriveUiDeployment(configWith({ mode: "development", deployment: "saas" }));

    expect(deployment.isDevelopment).toBe(true);
    expect(deployment.isSaaS).toBe(true);
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

  describe("given no demo project", () => {
    it("omits the slug", () => {
      expect("demoProjectSlug" in deriveUiDeployment(configWith({}))).toBe(false);
    });
  });
});
