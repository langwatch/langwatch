/**
 * @vitest-environment jsdom
 *
 * The "Back to {product}" entry at the top of the Settings sidebar: the page
 * the reader came in from when this tab captured one, the remembered product's
 * home otherwise, and a plain "Back" when neither can be resolved.
 *
 * Written HERE rather than moved, for the same reason as the two suites beside
 * it: the platform test was swept before the module travelled. The
 * organization check is the case worth keeping honest — switching organization
 * inside Settings makes a captured project address belong to somewhere else.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  captureSettingsReturnPath,
  resolveSettingsBackTarget,
} from "../resolve-settings-back-target";

beforeEach(() => {
  sessionStorage.clear();
});

describe("resolveSettingsBackTarget", () => {
  describe("given this tab captured the page Settings was entered from", () => {
    it("returns to that exact address, query included", () => {
      captureSettingsReturnPath({
        organizationId: "org_1",
        pathname: "/acme-app/traces",
        search: "?span=abc",
      });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: "gateway",
          reachableProducts: ["gateway"],
          projectSlug: "acme-app",
        }),
      ).toEqual({ label: "Back to LLM Ops", href: "/acme-app/traces?span=abc" });
    });

    it("drops it after an organization switch, so it never returns somewhere else", () => {
      captureSettingsReturnPath({ organizationId: "org_1", pathname: "/acme-app/traces" });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_2",
          rememberedProduct: "me",
          reachableProducts: ["me"],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Me", href: "/me" });
    });
  });

  describe("given Settings was opened directly in a fresh tab", () => {
    it("captures nothing for an address that is not a product page", () => {
      captureSettingsReturnPath({ organizationId: "org_1", pathname: "/settings/members" });

      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: null,
          reachableProducts: [],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back", href: "/" });
    });

    it("falls back to the remembered product's home when it is still reachable", () => {
      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: "governance",
          reachableProducts: ["governance"],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back to Governance", href: "/governance" });
    });

    it("ignores a remembered product the reader can no longer reach", () => {
      expect(
        resolveSettingsBackTarget({
          organizationId: "org_1",
          rememberedProduct: "gateway",
          reachableProducts: ["llm-ops"],
          projectSlug: null,
        }),
      ).toEqual({ label: "Back", href: "/" });
    });
  });
});
