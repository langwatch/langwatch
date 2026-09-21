/**
 * Spec: specs/navigation/navigation-v2-landing.feature
 */
import { describe, expect, it } from "vitest";
import { resolveOrgSwitchDestination } from "../resolveOrgSwitchDestination";

describe("resolveOrgSwitchDestination", () => {
  describe("when the product is reachable in the target organization", () => {
    /** @scenario Switching organization stays in the same product when possible */
    it("lands on the same product home there", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "gateway",
          reachableProducts: ["me", "llm-ops", "gateway"],
          projectSlug: "beta",
        }),
      ).toBe("/gateway/virtual-keys");
    });
  });

  describe("when the product is not reachable in the target organization", () => {
    /** @scenario Switching organization falls back when the product is not reachable */
    it("falls back to the project home, then Me, then the root", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "governance",
          reachableProducts: ["me", "llm-ops"],
          projectSlug: "beta",
        }),
      ).toBe("/beta");
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "governance",
          reachableProducts: ["me"],
          projectSlug: null,
        }),
      ).toBe("/me");
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "governance",
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toBe("/");
    });
  });

  describe("when LLM Ops is current but the target has no project", () => {
    it("falls through the project fallback to Me", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "llm-ops",
          reachableProducts: ["me", "llm-ops"],
          projectSlug: null,
        }),
      ).toBe("/me");
    });
  });
});
