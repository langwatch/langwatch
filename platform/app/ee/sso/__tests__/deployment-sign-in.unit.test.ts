import { describe, expect, it } from "vitest";
import { deploymentSignInFor } from "../deployment-sign-in";

const BASE_URL = "https://langwatch.acme.com/";

describe("deploymentSignInFor", () => {
  describe("when the deployment signs in with email only", () => {
    it.each([
      undefined,
      "email",
    ])("names no other sign-in for %s", (provider) => {
      expect(deploymentSignInFor({ provider, baseUrl: BASE_URL })).toBeNull();
    });
  });

  describe("when the deployment configures Microsoft", () => {
    it("names the azure-ad callback the Microsoft sign-in sends", () => {
      expect(
        deploymentSignInFor({
          provider: "azure-ad",
          baseUrl: BASE_URL,
        }),
      ).toEqual({
        name: "Microsoft",
        redirectUrl: "https://langwatch.acme.com/api/auth/callback/azure-ad",
      });
    });
  });

  describe("when the deployment configures another provider", () => {
    it.each([
      ["okta", "Okta"],
      ["google", "Google"],
      ["oidc", "OpenID Connect"],
    ])("names /api/auth/callback/%s", (provider, name) => {
      expect(deploymentSignInFor({ provider, baseUrl: BASE_URL })).toEqual({
        name,
        redirectUrl: `https://langwatch.acme.com/api/auth/callback/${provider}`,
      });
    });
  });
});
