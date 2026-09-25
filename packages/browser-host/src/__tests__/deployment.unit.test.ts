import { describe, expect, it } from "vitest";

import { deriveUiDeployment, type UiDeploymentSlices } from "../deployment.ts";

/** Whole slices, so a field the reading stops using fails here rather than being cast away. */
function slicesWith(overrides: Partial<UiDeploymentSlices>): UiDeploymentSlices {
  return {
    process: {
      appBaseUrl: "https://app.example",
      mode: "production",
      deployment: "self-hosted",
      nlp: true,
      browserTracing: false,
      sampleRatio: 0,
    },
    origin: "https://page.example",
    hasLangevals: true,
    hasEmailProvider: true,
    passkeysEnabled: false,
    ...overrides,
  };
}

describe("deriveUiDeployment", () => {
  it("reads the deployment shape off the process slice", () => {
    const deployment = deriveUiDeployment(
      slicesWith({
        process: {
          appBaseUrl: "https://app.example",
          mode: "development",
          deployment: "saas",
          nlp: false,
          browserTracing: false,
          sampleRatio: 0,
        },
      }),
    );

    expect(deployment.isDevelopment).toBe(true);
    expect(deployment.isSaaS).toBe(true);
    expect(deployment.hasNlpService).toBe(false);
    expect(deployment.appBaseUrl).toBe("https://app.example");
  });

  describe("given a process that named no public address", () => {
    it("answers the page's own origin rather than an empty link", () => {
      const deployment = deriveUiDeployment(
        slicesWith({
          process: {
            mode: "production",
            deployment: "self-hosted",
            nlp: true,
            browserTracing: false,
            sampleRatio: 1,
          },
        }),
      );

      expect(deployment.appBaseUrl).toBe("https://page.example");
    });
  });

  describe("given a deployment that sells a licence", () => {
    it("carries the purchase address, so a host never reads the meta tag itself", () => {
      const deployment = deriveUiDeployment(
        slicesWith({ licensePaymentUrl: "https://buy.example/licence" }),
      );

      expect(deployment.licensePaymentUrl).toBe("https://buy.example/licence");
    });
  });

  describe("given a deployment that sells none", () => {
    it("omits the field rather than carrying an empty one", () => {
      expect("licensePaymentUrl" in deriveUiDeployment(slicesWith({}))).toBe(false);
    });
  });

  describe("given a deployment with no mail provider", () => {
    it("says so, so the invite flow offers a link instead of claiming a send", () => {
      expect(deriveUiDeployment(slicesWith({ hasEmailProvider: false })).hasEmailProvider).toBe(
        false,
      );
    });
  });

  describe("given a deployment behind a federated sign-in provider", () => {
    it("names the provider, so the security screen offers to link it", () => {
      const deployment = deriveUiDeployment(
        slicesWith({ authProvider: "auth0", passkeysEnabled: true }),
      );

      expect(deployment.authProvider).toBe("auth0");
      expect(deployment.passkeysEnabled).toBe(true);
    });
  });

  describe("given no demo project", () => {
    it("omits the slug", () => {
      expect("demoProjectSlug" in deriveUiDeployment(slicesWith({}))).toBe(false);
    });
  });
});
