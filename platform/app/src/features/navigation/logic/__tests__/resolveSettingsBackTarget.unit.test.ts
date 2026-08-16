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
        pathname: "/gateway/budgets",
        search: "?days=mtd",
      });

      expect(
        resolveSettingsBackTarget({
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({
        label: "Back to Gateway",
        href: "/gateway/budgets?days=mtd",
      });
    });

    /** @scenario Settings is never the remembered product */
    it("never captures a settings page as the return path", () => {
      captureSettingsReturnPath({ pathname: "/gateway/budgets" });
      captureSettingsReturnPath({ pathname: "/settings/members" });

      expect(
        resolveSettingsBackTarget({
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }).href,
      ).toBe("/gateway/budgets");
    });
  });

  describe("when a fresh tab opened settings directly", () => {
    /** @scenario The Settings back entry works even in a fresh tab */
    it("falls back to the remembered product home", () => {
      expect(
        resolveSettingsBackTarget({
          rememberedProduct: "governance",
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Governance", href: "/governance" });
    });

    it("falls back to the root when nothing is remembered", () => {
      expect(
        resolveSettingsBackTarget({
          rememberedProduct: null,
          reachableProducts: ALL,
          projectSlug: null,
        }),
      ).toEqual({ label: "Back", href: "/" });
    });
  });
});
