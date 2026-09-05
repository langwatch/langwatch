/**
 * @vitest-environment jsdom
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
    /** @scenario Leaving Settings goes back to the product I came from */
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

    /** @scenario The back entry drops a page from another organization */
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
    /** @scenario Settings is never the remembered product */
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

    /** @scenario The Settings back entry works even in a fresh tab */
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
