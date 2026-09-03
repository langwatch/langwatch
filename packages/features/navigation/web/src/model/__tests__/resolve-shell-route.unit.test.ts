/**
 * Which product an address belongs to, and which scope its chrome carries.
 *
 * Written HERE rather than moved: the platform suite for this function was
 * swept with the rest of `platform/app`'s unreachable navigation before the
 * module travelled, and a resolver the chrome asks on every render may not
 * arrive without one. The cases are the ones its own docblock names — the
 * settings detour, the personal scope, and the segment-boundary trap a plain
 * prefix test falls into.
 *
 * Specs: specs/navigation/product-switcher-navigation.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */

import { describe, expect, it } from "vitest";
import { resolveShellRoute } from "../resolve-shell-route";

function resolve(
  pathname: string,
  {
    isPersonalScope = false,
    isOrgScope = false,
    isOnOwnPersonalProject = false,
  }: {
    isPersonalScope?: boolean;
    isOrgScope?: boolean;
    isOnOwnPersonalProject?: boolean;
  } = {},
) {
  return resolveShellRoute({ pathname, isPersonalScope, isOrgScope, isOnOwnPersonalProject });
}

describe("resolveShellRoute", () => {
  describe("given a product address", () => {
    it("names the gateway, and reads it as organization scope", () => {
      expect(resolve("/gateway/virtual-keys")).toEqual({
        isSettingsRoute: false,
        isPersonalScopeRoute: false,
        isOrgScopeRoute: true,
        activeProductId: "gateway",
      });
    });

    it("names governance, and reads it as organization scope", () => {
      expect(resolve("/governance/people").activeProductId).toBe("governance");
      expect(resolve("/governance/people").isOrgScopeRoute).toBe(true);
    });

    it("reads a bare project address as LLM Ops", () => {
      expect(resolve("/acme-app/traces")).toEqual({
        isSettingsRoute: false,
        isPersonalScopeRoute: false,
        isOrgScopeRoute: false,
        activeProductId: "llm-ops",
      });
    });
  });

  describe("given the settings detour", () => {
    /**
     * Two specs name the same detour from different angles — the ops feature
     * file calls it the detour, the modes file calls it the shell that draws
     * around an ops page. One classifier decides both.
     *
     * @scenario The internal ops pages take the settings detour
     * @scenario Internal ops pages render in the new settings shell
     */
    it("is not a product, and carries organization scope", () => {
      for (const pathname of ["/settings/members", "/ops/backoffice/users"]) {
        expect(resolve(pathname)).toEqual({
          isSettingsRoute: true,
          isPersonalScopeRoute: false,
          isOrgScopeRoute: true,
          activeProductId: null,
        });
      }
    });
  });

  describe("given a personal address", () => {
    it("names Me for /me itself", () => {
      expect(resolve("/me/sessions").activeProductId).toBe("me");
      expect(resolve("/me/sessions").isPersonalScopeRoute).toBe(true);
    });

    it("names Me when the reader is on their own personal project", () => {
      expect(
        resolve("/personal-mia-abc123", { isOnOwnPersonalProject: true }).activeProductId,
      ).toBe("me");
    });

    it("keeps the settings detour out of the personal scope", () => {
      expect(resolve("/settings/members", { isPersonalScope: true }).isPersonalScopeRoute).toBe(
        false,
      );
    });
  });

  describe("given a project whose slug starts with a reserved base", () => {
    /**
     * A plain `startsWith` reads "metadata" as the Me product and
     * "settings-team" as Settings. Project slugs are top-level addresses and
     * neither name is reserved, so the test has to be on the segment boundary.
     */
    it("reads it as the project it is, not as the product it prefixes", () => {
      expect(resolve("/metadata/traces").activeProductId).toBe("llm-ops");
      expect(resolve("/settings-team").isSettingsRoute).toBe(false);
      expect(resolve("/settings-team").activeProductId).toBe("llm-ops");
    });
  });
});
