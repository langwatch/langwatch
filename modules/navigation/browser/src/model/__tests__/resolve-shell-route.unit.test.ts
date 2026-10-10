/** Product and scope resolver; written after platform sweep; cases: settings/personal/boundary */

import { describe, expect, it } from "vitest";

import { resolveShellRoute } from "../resolve-shell-route.ts";

function resolve(
  pathname: string,
  {
    isPersonalScope = false,
    isOrgScope = false,
    isOnOwnPersonalProject = false,
    organizationRole = "MEMBER",
  }: {
    isPersonalScope?: boolean;
    isOrgScope?: boolean;
    isOnOwnPersonalProject?: boolean;
    organizationRole?: string;
  } = {},
) {
  return resolveShellRoute({
    pathname,
    isPersonalScope,
    isOrgScope,
    isOnOwnPersonalProject,
    organizationRole,
  });
}

describe("resolveShellRoute", () => {
  describe("given a product address", () => {
    it("names the gateway, and reads it as organization scope", () => {
      expect(resolve("/gateway/virtual-keys")).toEqual({
        isSettingsRoute: false,
        isPersonalScopeRoute: false,
        isOrgScopeRoute: true,
        isResolverRoute: false,
        activeProductId: "gateway",
        seatRefusal: null,
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
        isResolverRoute: false,
        activeProductId: "llm-ops",
        seatRefusal: null,
      });
    });
  });

  describe("given the last workspace was my personal one", () => {
    /** @scenario A sticky personal workspace does not follow me onto an org-wide page */
    it.each(["/gateway/virtual-keys", "/governance/people"])(
      "keeps %s on the organization scope its address asks for",
      (pathname) => {
        const route = resolve(pathname, { isPersonalScope: true });

        expect(route.isPersonalScopeRoute).toBe(false);
        expect(route.isOrgScopeRoute).toBe(true);
        expect(route.activeProductId).not.toBe("me");
      },
    );
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
      for (const pathname of ["/settings/members", "/ops/users", "/ops/cloud/licenses"]) {
        expect(resolve(pathname)).toEqual({
          isSettingsRoute: true,
          isPersonalScopeRoute: false,
          isOrgScopeRoute: true,
          isResolverRoute: false,
          activeProductId: null,
          seatRefusal: null,
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
    /** @scenario A project whose slug reads like a product keeps the project shell */
    it("reads it as the project it is, not as the product it prefixes", () => {
      expect(resolve("/metadata/traces").activeProductId).toBe("llm-ops");
      expect(resolve("/settings-team").isSettingsRoute).toBe(false);
      expect(resolve("/settings-team").activeProductId).toBe("llm-ops");
    });
  });

  describe("given a Developer seat", () => {
    describe("when the address names an organization-wide product", () => {
      it.each([
        ["/gateway/virtual-keys", "gateway", "virtualKeys:view"],
        ["/governance/people", "governance", "governance:view"],
      ])("refuses %s with the product's grant named", (pathname, productId, permission) => {
        expect(resolve(pathname, { organizationRole: "DEVELOPER" }).seatRefusal).toEqual({
          productId,
          permission,
        });
      });
    });

    describe("when the address names their own Me workspace or a project", () => {
      it.each(["/me/sessions", "/personal-ada-abc123/traces"])("opens %s", (pathname) => {
        expect(resolve(pathname, { organizationRole: "DEVELOPER" }).seatRefusal).toBeNull();
      });
    });

    describe("when the address belongs to no product", () => {
      it.each(["/settings/profile", "/onboarding/welcome", "/"])(
        "leaves %s to the permission gate",
        (pathname) => {
          expect(resolve(pathname, { organizationRole: "DEVELOPER" }).seatRefusal).toBeNull();
        },
      );
    });
  });

  describe("given a Full seat", () => {
    it("opens an organization-wide product, the seat gate being for the Developer seat only", () => {
      expect(
        resolve("/gateway/virtual-keys", { organizationRole: "MEMBER" }).seatRefusal,
      ).toBeNull();
    });
  });
});
