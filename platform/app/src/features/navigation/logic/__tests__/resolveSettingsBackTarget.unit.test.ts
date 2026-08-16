/**
 * @vitest-environment jsdom
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 *       specs/navigation/navigation-v2-product-memory.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureSettingsReturnPath,
  resolveSettingsBackTarget,
} from "../resolveSettingsBackTarget";

const ALL = ["me", "llm-ops", "gateway", "governance"] as const;

beforeEach(() => {
  sessionStorage.clear();
});

describe("settings back target", () => {
  describe("when settings was opened from a product page", () => {
    /** @scenario Leaving Settings goes back to the product I came from */
    it("returns to the captured page with its product label", () => {
      captureSettingsReturnPath({
        organizationId: "org_1",
        pathname: "/gateway/budgets",
        search: "?days=mtd",
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({
        label: "Back to Gateway",
        href: "/gateway/budgets?days=mtd",
      });
    });

    it("names the product from the address, not from its query", () => {
      captureSettingsReturnPath({
        organizationId: "org_1",
        pathname: "/gateway",
        search: "?tab=usage",
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Gateway", href: "/gateway?tab=usage" });
    });

    /** @scenario Settings is never the remembered product */
    it("never captures a settings page as the return path", () => {
      captureSettingsReturnPath({
        organizationId: "org_1",
        pathname: "/gateway/budgets",
      });
      captureSettingsReturnPath({
        organizationId: "org_1",
        pathname: "/settings/members",
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }).href,
      ).toBe("/gateway/budgets");
    });

    /** @scenario The back entry drops a page from another organization */
    it("drops a page captured in another organization", () => {
      captureSettingsReturnPath({
        organizationId: "org_1",
        pathname: "/gateway/budgets",
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_2",
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({ label: "Back", href: "/" });
    });
  });

  describe("when a fresh tab opened settings directly", () => {
    /** @scenario The Settings back entry works even in a fresh tab */
    it("falls back to the remembered product home", () => {
      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: "governance",
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Governance", href: "/governance" });
    });

    it("falls back to the root when nothing is remembered", () => {
      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({ label: "Back", href: "/" });
    });
  });
});
