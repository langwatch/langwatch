/**
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
import { describe, expect, it } from "vitest";
import { resolveShellRoute } from "../resolveShellRoute";

const base = {
  isPersonalScope: false,
  isOrgScope: false,
  isOnOwnPersonalProject: false,
};

describe("shell route classification", () => {
  describe("when the address is a product page", () => {
    it("names the product that owns it", () => {
      expect(
        resolveShellRoute({ ...base, pathname: "/me" }).activeProductId,
      ).toBe("me");
      expect(
        resolveShellRoute({ ...base, pathname: "/gateway/budgets" })
          .activeProductId,
      ).toBe("gateway");
      expect(
        resolveShellRoute({ ...base, pathname: "/settings/members" })
          .isSettingsRoute,
      ).toBe(true);
    });
  });

  describe("when a project slug reads like a top-level product", () => {
    /**
     * A project slug is a top-level address, and neither name is reserved,
     * so the classifier must not read them as Me or Settings.
     *
     * @scenario A project whose slug reads like a product keeps the project shell
     */
    it("classifies a project named metadata as a project page", () => {
      const route = resolveShellRoute({
        ...base,
        pathname: "/metadata/unknown-page",
      });

      expect(route.activeProductId).toBe("llm-ops");
      expect(route.isPersonalScopeRoute).toBe(false);
      expect(route.isSettingsRoute).toBe(false);
      expect(route.isOrgScopeRoute).toBe(false);
    });

    /** @scenario A project whose slug reads like a product keeps the project shell */
    it("classifies a project named settings-team as a project page", () => {
      const route = resolveShellRoute({
        ...base,
        pathname: "/settings-team/prompts",
      });

      expect(route.isSettingsRoute).toBe(false);
      expect(route.activeProductId).toBe("llm-ops");
    });

    it("keeps the same answer for the resolved project route pattern", () => {
      const route = resolveShellRoute({
        ...base,
        pathname: "/[project]/traces",
      });

      expect(route.activeProductId).toBe("llm-ops");
      expect(route.isPersonalScopeRoute).toBe(false);
    });
  });

  describe("when the scope is forced by the page", () => {
    it("keeps a personal-scope page personal", () => {
      const route = resolveShellRoute({
        ...base,
        isPersonalScope: true,
        pathname: "/[project]",
      });

      expect(route.activeProductId).toBe("me");
      expect(route.isPersonalScopeRoute).toBe(true);
    });
  });

  describe("when the reader's sticky scope is their own personal workspace", () => {
    // The control, and the reason the two below are not vacuous: this input
    // does put the reader in the personal shell wherever it is allowed to.
    it("puts a project page in the personal shell", () => {
      const route = resolveShellRoute({
        ...base,
        isOnOwnPersonalProject: true,
        pathname: "/[project]/traces",
      });

      expect(route.isPersonalScopeRoute).toBe(true);
      expect(route.activeProductId).toBe("me");
    });

    /** @scenario "A sticky personal workspace does not follow me onto an org-wide page" */
    it("leaves a Gateway page organization-scoped", () => {
      const route = resolveShellRoute({
        ...base,
        isOnOwnPersonalProject: true,
        pathname: "/gateway/virtual-keys",
      });

      expect(route.isPersonalScopeRoute).toBe(false);
      expect(route.activeProductId).toBe("gateway");
      expect(route.isOrgScopeRoute).toBe(true);
    });

    /** @scenario "A sticky personal workspace does not follow me onto an org-wide page" */
    it("leaves a Governance page organization-scoped", () => {
      const route = resolveShellRoute({
        ...base,
        isOnOwnPersonalProject: true,
        pathname: "/governance/costs",
      });

      expect(route.isPersonalScopeRoute).toBe(false);
      expect(route.activeProductId).toBe("governance");
      expect(route.isOrgScopeRoute).toBe(true);
    });
  });

  describe("when the address is an internal ops page", () => {
    /** @scenario Internal ops pages render in the new settings shell */
    it("takes the settings detour so the settings shell draws around it", () => {
      const route = resolveShellRoute({
        ...base,
        pathname: "/ops/feature-flags",
      });

      expect(route.isSettingsRoute).toBe(true);
      expect(route.activeProductId).toBeNull();
      expect(route.isOrgScopeRoute).toBe(true);
    });
  });
});
