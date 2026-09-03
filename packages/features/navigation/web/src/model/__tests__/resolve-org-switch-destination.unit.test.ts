/**
 * Where an in-place organization switch lands.
 *
 * Written HERE rather than moved, for the same reason as the shell-route
 * suite beside it: the platform test was swept before the module travelled.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */

import { describe, expect, it } from "vitest";
import { resolveOrgSwitchDestination } from "../resolve-org-switch-destination";

describe("resolveOrgSwitchDestination", () => {
  describe("given the current product is reachable in the new organization", () => {
    /** @scenario Switching organization stays in the same product when possible */
    it("lands on that product's home there", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "gateway",
          reachableProducts: ["me", "gateway"],
          projectSlug: "acme-app",
        }),
      ).toBe("/gateway/virtual-keys");
    });

    it("falls through when the product has no home to offer", () => {
      // LLM Ops without a project resolves no home; the next candidate wins.
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "llm-ops",
          reachableProducts: ["llm-ops", "me"],
          projectSlug: null,
        }),
      ).toBe("/me");
    });
  });

  describe("given the current product is not reachable there", () => {
    /** @scenario Switching organization falls back when the product is not reachable */
    it("lands on that organization's project home", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "governance",
          reachableProducts: ["llm-ops"],
          projectSlug: "acme-app",
        }),
      ).toBe("/acme-app");
    });

    it("lands on Me when there is no project and Me is reachable", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "governance",
          reachableProducts: ["me"],
          projectSlug: null,
        }),
      ).toBe("/me");
    });
  });

  describe("given nothing can be decided", () => {
    it("lands on the root, which re-resolves", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: null,
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toBe("/");
    });
  });
});
