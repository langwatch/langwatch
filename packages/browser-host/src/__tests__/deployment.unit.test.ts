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
    },
    origin: "https://page.example",
    hasLangevals: true,
    hasEmailProvider: true,
    passkeysEnabled: false,
    emailPasswordEnabled: false,
    hasCloudOps: false,
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
          },
        }),
      );

      expect(deployment.appBaseUrl).toBe("https://page.example");
    });
  });

  describe("when the installation names a public URL besides BASE_HOST", () => {
    /** @scenario "The browser deployment prefers the public URL over BASE_HOST" */
    it("answers the public URL, the one every setup snippet copies", () => {
      const deployment = deriveUiDeployment(
        slicesWith({
          process: {
            appBaseUrl: "http://localhost:5560",
            mode: "production",
            deployment: "self-hosted",
            nlp: true,
          },
          publicUrl: "http://localhost:5580",
        }),
      );

      expect(deployment.appBaseUrl).toBe("http://localhost:5580");
    });
  });

  describe("when the installation names no public URL", () => {
    /** @scenario "The browser deployment falls back to BASE_HOST without a public URL" */
    it("answers BASE_HOST", () => {
      expect(deriveUiDeployment(slicesWith({})).appBaseUrl).toBe("https://app.example");
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

  describe("given ops offering cloud ops", () => {
    it("carries the capability through, and reads it off by default", () => {
      expect(deriveUiDeployment(slicesWith({ hasCloudOps: true })).hasCloudOps).toBe(true);
      expect(deriveUiDeployment(slicesWith({})).hasCloudOps).toBe(false);
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
        slicesWith({ authProvider: "auth0", passkeysEnabled: true, emailPasswordEnabled: true }),
      );

      expect(deployment.authProvider).toBe("auth0");
      expect(deployment.passkeysEnabled).toBe(true);
      expect(deployment.emailPasswordEnabled).toBe(true);
    });
  });

  describe("given a gateway address", () => {
    it("carries it, and omits the key when none is configured", () => {
      expect(
        deriveUiDeployment(slicesWith({ gatewayBaseUrl: "http://localhost:5563" })).gatewayBaseUrl,
      ).toBe("http://localhost:5563");
      expect("gatewayBaseUrl" in deriveUiDeployment(slicesWith({}))).toBe(false);
    });
  });

  describe("given no demo project", () => {
    it("omits the slug", () => {
      expect("demoProjectSlug" in deriveUiDeployment(slicesWith({}))).toBe(false);
    });
  });
});
