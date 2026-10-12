import { describe, expect, it } from "vitest";
import { federatedProviderLabel } from "../methodLabels";

describe("federatedProviderLabel", () => {
  describe("when the provider id is a known one", () => {
    it("returns the provider's own name", () => {
      expect(federatedProviderLabel("google")).toBe("Google");
    });
  });

  describe("when the provider id is not listed", () => {
    it("falls back to single sign-on", () => {
      expect(federatedProviderLabel("oidc")).toBe("single sign-on");
    });
  });
});
