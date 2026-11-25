/**
 * Where an in-place organization switch lands. Written HERE rather than
 * moved, for the same reason as the shell-route suite beside it: the
 * platform test was swept before the module travelled.
 */

import { describe, expect, it } from "vitest";

import { resolveOrgSwitchDestination } from "../resolve-org-switch-destination.ts";

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

    it("stays in Dashboards, on the new organization's project", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "dashboards",
          reachableProducts: ["llm-ops", "dashboards"],
          projectSlug: "beta-app",
        }),
      ).toBe("/beta-app/dashboards");
    });

    /** @scenario "Switching organization on an org-level page" */
    it("lands on the new organization's library when it has the Dashboards area", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "dashboards",
          reachableProducts: ["llm-ops", "dashboards"],
          projectSlug: "beta-app",
          hasOrganizationLibrary: true,
        }),
      ).toBe("/dashboards");
    });

    /** @scenario Switching organization falls through a product with no project */
    it("lands on the root when the product has no home to offer", () => {
      // The root re-resolves server side, where a Billing-only override can
      // answer the plan page; picking a product here would skip that answer.
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "llm-ops",
          reachableProducts: ["llm-ops", "me"],
          projectSlug: null,
        }),
      ).toBe("/");
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

    /** @scenario Switching organization with no project lands on root */
    it("lands on the root when there is no project and Me is reachable", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: "governance",
          reachableProducts: ["me"],
          projectSlug: null,
        }),
      ).toBe("/");
    });
  });

  describe("given the reader is on the settings detour", () => {
    it("stays on the settings page they were reading", () => {
      // The detour carries no product, so `currentProduct` is null there;
      // without the address the resolver would throw them out of settings.
      expect(
        resolveOrgSwitchDestination({
          currentProduct: null,
          reachableProducts: ["llm-ops"],
          projectSlug: "beta-app",
          settingsPathname: "/settings/members",
        }),
      ).toBe("/settings/members");
    });

    it("stays on the settings root", () => {
      expect(
        resolveOrgSwitchDestination({
          currentProduct: null,
          reachableProducts: [],
          projectSlug: "beta-app",
          settingsPathname: "/settings",
        }),
      ).toBe("/settings");
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
